import { BacktestEngine } from '@/backtest/engine';
import { IchimokuRsiStrategy } from '@/strategies/ichimoku-rsi-strategy';
import {
  buildBacktestReport,
  computeDrawdownPeriods,
  computeTradeTrajectories,
  formatHistoryWinRate,
  formatHistoryRow,
  type BacktestReportInput,
} from '@/backtest/report';
import type { Candle } from '@/data/models/candle';
import type { BacktestResult, Trade } from '@/backtest/types';

describe('Backtest Report Builder & Tracing', () => {
  const createCandle = (
    index: number,
    open: number,
    high: number,
    low: number,
    close: number
  ): Candle => ({
    timestamp: 1600000000000 + index * 3600000,
    open,
    high,
    low,
    close,
    volume: 1000,
  });

  // Generate an oscillating series of 100 candles that triggers signals and positions
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 100; i++) {
    const cycle = Math.sin(i / 5);
    const delta = cycle * 2;
    const open = price;
    const close = Math.max(10, open + delta);
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    candles.push(createCandle(i, open, high, low, close));
    price = close;
  }

  const baseMetrics = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    sharpeRatio: 0,
    averageTradeReturn: 0,
    bestTrade: 0,
    worstTrade: 0,
    finalBalance: 10000,
    totalFees: 0,
    totalFeesPercent: 0,
    averageWin: 0,
    averageLoss: 0,
    feeDragPercent: 0,
    long: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
    short: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
  };

  const makeReportInput = (trades: Trade[], overrides: Partial<typeof baseMetrics> = {}): BacktestReportInput => {
    const metrics = { ...baseMetrics, ...overrides };
    const backtestResult: BacktestResult = {
      config: { strategy: new IchimokuRsiStrategy(), initialBalance: 10000 },
      trades,
      metrics,
      equity: [10000, 10000],
    };
    return {
      backtestResult,
      candles,
      config: {
        symbol: 'BTCUSDT',
        interval: '1h',
        initialBalance: 10000,
      },
    };
  };

  describe('1. Trace Non-Interference', () => {
    it('should produce 100% bit-identical trades and equity curve with vs without trace', () => {
      const strategyWithoutTrace = new IchimokuRsiStrategy({
        tenkan: 4,
        kijun: 8,
        senkouB: 16,
        displacement: 4,
        rsiPeriod: 7,
        rsiLookback: 5,
      });

      const strategyWithTrace = new IchimokuRsiStrategy({
        tenkan: 4,
        kijun: 8,
        senkouB: 16,
        displacement: 4,
        rsiPeriod: 7,
        rsiLookback: 5,
      });

      const engine = new BacktestEngine();

      const resultWithoutTrace = engine.run({
        strategy: strategyWithoutTrace,
        candles,
        initialBalance: 10000,
        tradeFeePercent: 0.1,
        positionSizePercent: 20,
        riskPerTradePercent: 1,
        tradeMode: 'long-short',
        trailingStop: {
          initialStopPercent: 5,
          stepPercent: 10,
          raisePercent: 5,
        },
        collectTrace: false,
      });

      const resultWithTrace = engine.run({
        strategy: strategyWithTrace,
        candles,
        initialBalance: 10000,
        tradeFeePercent: 0.1,
        positionSizePercent: 20,
        riskPerTradePercent: 1,
        tradeMode: 'long-short',
        trailingStop: {
          initialStopPercent: 5,
          stepPercent: 10,
          raisePercent: 5,
        },
        collectTrace: true,
      });

      // Assert trades are strictly identical
      expect(resultWithTrace.trades).toEqual(resultWithoutTrace.trades);
      // Assert equity curve is strictly identical
      expect(resultWithTrace.equity).toEqual(resultWithoutTrace.equity);
      // Assert metrics are strictly identical
      expect(resultWithTrace.metrics).toEqual(resultWithoutTrace.metrics);

      // Trace must be absent when false, present when true
      expect(resultWithoutTrace.trace).toBeUndefined();
      expect(resultWithTrace.trace).toBeDefined();
      expect(Array.isArray(resultWithTrace.trace?.tkCrossEvents)).toBe(true);
      expect(Array.isArray(resultWithTrace.trace?.ignoredSignals)).toBe(true);
    });

    it('should yield identical signals from strategy analyze with or without trace collector', () => {
      const strategy1 = new IchimokuRsiStrategy({ tenkan: 4, kijun: 8, senkouB: 16, displacement: 4 });
      const strategy2 = new IchimokuRsiStrategy({ tenkan: 4, kijun: 8, senkouB: 16, displacement: 4 });

      strategy2.setTraceCollector({ onTkCross: () => {} });

      for (let i = 0; i < candles.length; i++) {
        const sig1 = strategy1.analyze(candles, i);
        const sig2 = strategy2.analyze(candles, i);
        expect(sig2.action).toBe(sig1.action);
        expect(sig2.price).toBe(sig1.price);
        expect(sig2.timestamp).toBe(sig1.timestamp);
      }
    });
  });

  describe('2. Report Builder Structure & Order', () => {
    it('should format sections A through K in exact sequential order', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 4,
        kijun: 8,
        senkouB: 16,
        displacement: 4,
        rsiPeriod: 7,
        rsiLookback: 5,
      });
      const engine = new BacktestEngine();
      const backtestResult = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeFeePercent: 0.1,
        positionSizePercent: 20,
        trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
        collectTrace: true,
      });

      const reportInput: BacktestReportInput = {
        backtestResult,
        candles,
        config: {
          symbol: 'BTCUSDT',
          interval: '1h',
          period: '6y',
          dataSource: 'cache',
          gitCommit: 'test1234',
          isDirty: false,
          tenkan: 4,
          kijun: 8,
          senkouB: 16,
          displacement: 4,
          rsiPeriod: 7,
          rsiLookback: 5,
          positionSizePercent: 20,
          trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
          initialBalance: 10000,
        },
      };

      const output = buildBacktestReport(reportInput);

      expect(typeof output.markdown).toBe('string');
      expect(typeof output.configHash).toBe('string');
      expect(output.configHash).toHaveLength(8);
      expect(output.json).toBeDefined();

      const md = output.markdown;
      const posA = md.indexOf('## Section A: Run Header');
      const posB = md.indexOf('## Section B: Summary Metrics');
      const posC = md.indexOf('## Section C: Automated Warning Flags');
      const posD = md.indexOf('## Section D: Signal Funnel');
      const posE = md.indexOf('## Section E: Compact Trades Table');
      const posF = md.indexOf('## Section F: Per-Trade Trajectory Analysis');
      const posG = md.indexOf('## Section G: Outlier Trades Analysis');
      const posH = md.indexOf('## Section H: Open Trade at Backtest Conclusion');
      const posI = md.indexOf('## Section I: Top 5 Drawdown Periods');
      const posJ = md.indexOf('## Section J: Performance Breakdowns');
      const posK = md.indexOf('## Section K: Invariant Self-Checks');

      expect(posA).toBeGreaterThan(-1);
      expect(posB).toBeGreaterThan(posA);
      expect(posC).toBeGreaterThan(posB);
      expect(posD).toBeGreaterThan(posC);
      expect(posE).toBeGreaterThan(posD);
      expect(posF).toBeGreaterThan(posE);
      expect(posG).toBeGreaterThan(posF);
      expect(posH).toBeGreaterThan(posG);
      expect(posI).toBeGreaterThan(posH);
      expect(posJ).toBeGreaterThan(posI);
      expect(posK).toBeGreaterThan(posJ);

      // Markdown size constraint: strictly <= 400KB
      expect(Buffer.byteLength(md, 'utf-8')).toBeLessThan(400 * 1024);
    });

    it('should include full machine-readable JSON structure', () => {
      const strategy = new IchimokuRsiStrategy({ tenkan: 4, kijun: 8, senkouB: 16, displacement: 4 });
      const engine = new BacktestEngine();
      const backtestResult = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        collectTrace: true,
      });

      const output = buildBacktestReport({
        backtestResult,
        candles,
        config: { symbol: 'BTCUSDT', interval: '1h', gitCommit: 'abc', isDirty: false },
      });

      const json = output.json;
      expect(json).toHaveProperty('meta');
      expect(json).toHaveProperty('summary');
      expect(json).toHaveProperty('flags');
      expect(json).toHaveProperty('funnel');
      expect(json).toHaveProperty('trades');
      expect(json).toHaveProperty('drawdowns');
      expect(json).toHaveProperty('breakdowns');
      expect(json).toHaveProperty('invariants');
    });
  });

  describe('3. Invariant Checks Verification', () => {
    it('should assert all invariants pass on valid backtest execution', () => {
      const strategy = new IchimokuRsiStrategy({ tenkan: 4, kijun: 8, senkouB: 16, displacement: 4 });
      const engine = new BacktestEngine();
      const backtestResult = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeFeePercent: 0.1,
        positionSizePercent: 20,
        trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
        collectTrace: true,
      });

      const output = buildBacktestReport({
        backtestResult,
        candles,
        config: {
          symbol: 'BTCUSDT',
          interval: '1h',
          initialBalance: 10000,
          tradeFeePercent: 0.1,
          trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
          gitCommit: 'test',
          isDirty: false,
        },
      });

      const invariants = output.json.invariants as Array<{ name: string; status: string; violations: number }>;
      expect(invariants).toBeDefined();
      expect(invariants.length).toBe(4);

      for (const inv of invariants) {
        expect(inv.status).toBe('PASS');
        expect(inv.violations).toBe(0);
      }
    });
  });

  describe('4. Trajectory & Drawdown Computation', () => {
    it('should correctly track drawdown depth and recovery', () => {
      const mockEquity = [10000, 10500, 11000, 9900, 9500, 10200, 11200];
      const mockCandles = mockEquity.map((eq, i) => createCandle(i, eq, eq + 10, eq - 10, eq));
      const drawdowns = computeDrawdownPeriods(mockEquity, mockCandles, []);

      expect(drawdowns.length).toBe(1);
      expect(drawdowns[0].peakEquity).toBe(11000);
      expect(drawdowns[0].troughEquity).toBe(9500);
      expect(drawdowns[0].isRecovered).toBe(true);
      expect(drawdowns[0].depthPercent).toBeCloseTo(-13.64, 1);
    });

    it('should compute trajectories with underwater bars and rebounds', () => {
      const relations = new Int8Array(candles.length).fill(0);
      const mockTrades = [
        {
          side: 'long' as const,
          exitReason: 'signal' as const,
          entrySignal: { action: 'BUY' as const, price: 100, timestamp: candles[5].timestamp },
          exitSignal: { action: 'SELL' as const, price: 105, timestamp: candles[15].timestamp },
          entryPrice: 100,
          exitPrice: 105,
          quantity: 1,
          pnl: 5,
          pnlPercent: 5,
          fee: 0.2,
          entryTime: candles[5].timestamp,
          exitTime: candles[15].timestamp,
          duration: 10,
          maxFavorablePercent: 8,
          maxAdversePercent: 3,
        },
      ];

      const trajectories = computeTradeTrajectories(mockTrades, candles, relations);
      expect(trajectories.length).toBe(1);
      expect(trajectories[0].barsHeld).toBe(10);
      expect(trajectories[0].tradeIndex).toBe(1);
      expect(typeof trajectories[0].underwaterBars).toBe('number');
    });
  });

  describe('5. Zero-Trade & Single-Side Metric Ambiguity Handlers', () => {
    it('should report N/A for profitFactor, winRate, expectancy, and trigger CRITICAL warning on zero trades', () => {
      const input = makeReportInput([]);
      const output = buildBacktestReport(input);

      // Markdown assertions
      expect(output.markdown).toContain('| **Profit Factor** | **N/A** | Gross Profit: $0.00 / Gross Loss: $0.00 (no trades executed) |');
      expect(output.markdown).toContain('| **Win Rate** | **N/A** | Long: N/A / Short: N/A |');
      expect(output.markdown).toContain('| **Average Win / Loss** | **N/A** / **N/A** | Win/Loss Ratio: N/A |');
      expect(output.markdown).toContain('| **Trade Expectancy** | **N/A** | Undefined (zero executed trades) |');
      expect(output.markdown).toContain('🚨 **[CRITICAL]** Zero Trades Executed: The backtest executed zero trades. Profitability, expectancy, and risk conclusions cannot be inferred from a zero-trade sample.');
      expect(output.markdown).not.toContain('No critical warning flags triggered.');

      // JSON assertions
      const summary = output.json.summary as Record<string, unknown>;
      expect(summary.profitFactor).toBeNull();
      expect(summary.profitFactorDisplay).toBe('N/A');
      expect(summary.winRate).toBeNull();
      expect((summary.long as Record<string, unknown>).winRate).toBeNull();
      expect((summary.short as Record<string, unknown>).winRate).toBeNull();
      expect(summary.expectancyPercent).toBeNull();
      expect(summary.averageWinPercent).toBeNull();
      expect(summary.averageLossPercent).toBeNull();

      const flags = output.json.flags as Array<{ level: string; message: string }>;
      expect(flags.some((f) => f.level === 'CRITICAL' && f.message.includes('Zero Trades Executed'))).toBe(true);
    });

    it('should distinguish a sample with one winning trade (zero gross losses)', () => {
      const winningTrade: Trade = {
        side: 'long',
        exitReason: 'takeProfit',
        entrySignal: { action: 'BUY', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'SELL', price: 105, timestamp: candles[5].timestamp },
        entryPrice: 100,
        exitPrice: 105,
        quantity: 1,
        pnl: 500,
        pnlPercent: 5.0,
        fee: 1,
        entryTime: candles[0].timestamp,
        exitTime: candles[5].timestamp,
        duration: 5,
        maxFavorablePercent: 6,
        maxAdversePercent: 0.5,
      };

      const input = makeReportInput([winningTrade], {
        totalTrades: 1,
        winningTrades: 1,
        winRate: 1.0,
        totalPnl: 500,
        totalPnlPercent: 5.0,
        averageWin: 5.0,
        long: { totalTrades: 1, winningTrades: 1, losingTrades: 0, winRate: 1.0, totalPnl: 500, totalPnlPercent: 5.0 },
      });

      const output = buildBacktestReport(input);

      // Markdown assertions
      expect(output.markdown).toContain('| **Profit Factor** | **N/A** | Gross Profit: $500.00 / Gross Loss: $0.00 (zero gross losses; undefined) |');
      expect(output.markdown).toContain('| **Average Win / Loss** | **+5.00%** / **N/A** | Win/Loss Ratio: N/A |');
      expect(output.markdown).toContain('| **Win Rate** | **100.0%** | Long: 100.0% / Short: N/A |');

      // JSON assertions
      const summary = output.json.summary as Record<string, unknown>;
      expect(summary.profitFactor).toBeNull();
      expect(summary.profitFactorDisplay).toBe('N/A');
      expect(summary.averageWinPercent).toBe(5.0);
      expect(summary.averageLossPercent).toBeNull();
      expect((summary.long as Record<string, unknown>).winRate).toBe(1.0);
      expect((summary.short as Record<string, unknown>).winRate).toBeNull();
    });

    it('should distinguish a sample with one losing trade (zero gross profit)', () => {
      const losingTrade: Trade = {
        side: 'short',
        exitReason: 'stopLoss',
        entrySignal: { action: 'SELL', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'BUY', price: 103, timestamp: candles[5].timestamp },
        entryPrice: 100,
        exitPrice: 103,
        quantity: 1,
        pnl: -300,
        pnlPercent: -3.0,
        fee: 1,
        entryTime: candles[0].timestamp,
        exitTime: candles[5].timestamp,
        duration: 5,
        maxFavorablePercent: 0.5,
        maxAdversePercent: 3.5,
      };

      const input = makeReportInput([losingTrade], {
        totalTrades: 1,
        losingTrades: 1,
        winRate: 0.0,
        totalPnl: -300,
        totalPnlPercent: -3.0,
        averageLoss: -3.0,
        short: { totalTrades: 1, winningTrades: 0, losingTrades: 1, winRate: 0.0, totalPnl: -300, totalPnlPercent: -3.0 },
      });

      const output = buildBacktestReport(input);

      // Markdown assertions
      expect(output.markdown).toContain('| **Profit Factor** | **0.00** | Gross Profit: $0.00 / Gross Loss: $300.00 (zero gross profit) |');
      expect(output.markdown).toContain('| **Average Win / Loss** | **N/A** / **-3.00%** | Win/Loss Ratio: N/A |');
      expect(output.markdown).toContain('| **Win Rate** | **0.0%** | Long: N/A / Short: 0.0% |');

      // JSON assertions
      const summary = output.json.summary as Record<string, unknown>;
      expect(summary.profitFactor).toBe(0);
      expect(summary.profitFactorDisplay).toBe('0.00');
      expect(summary.averageWinPercent).toBeNull();
      expect(summary.averageLossPercent).toBe(-3.0);
      expect((summary.long as Record<string, unknown>).winRate).toBeNull();
      expect((summary.short as Record<string, unknown>).winRate).toBe(0.0);
    });

    it('should compute numerical profit factor and win/loss ratio when both wins and losses exist', () => {
      const winTrade: Trade = {
        side: 'long',
        exitReason: 'takeProfit',
        entrySignal: { action: 'BUY', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'SELL', price: 104, timestamp: candles[3].timestamp },
        entryPrice: 100,
        exitPrice: 104,
        quantity: 1,
        pnl: 400,
        pnlPercent: 4.0,
        fee: 1,
        entryTime: candles[0].timestamp,
        exitTime: candles[3].timestamp,
        duration: 3,
        maxFavorablePercent: 4.5,
        maxAdversePercent: 0.5,
      };
      const lossTrade: Trade = {
        side: 'short',
        exitReason: 'stopLoss',
        entrySignal: { action: 'SELL', price: 100, timestamp: candles[4].timestamp },
        exitSignal: { action: 'BUY', price: 102, timestamp: candles[7].timestamp },
        entryPrice: 100,
        exitPrice: 102,
        quantity: 1,
        pnl: -200,
        pnlPercent: -2.0,
        fee: 1,
        entryTime: candles[4].timestamp,
        exitTime: candles[7].timestamp,
        duration: 3,
        maxFavorablePercent: 0.5,
        maxAdversePercent: 2.5,
      };

      const input = makeReportInput([winTrade, lossTrade], {
        totalTrades: 2,
        winningTrades: 1,
        losingTrades: 1,
        winRate: 0.5,
        totalPnl: 200,
        totalPnlPercent: 2.0,
        averageWin: 4.0,
        averageLoss: -2.0,
        long: { totalTrades: 1, winningTrades: 1, losingTrades: 0, winRate: 1.0, totalPnl: 400, totalPnlPercent: 4.0 },
        short: { totalTrades: 1, winningTrades: 0, losingTrades: 1, winRate: 0.0, totalPnl: -200, totalPnlPercent: -2.0 },
      });

      const output = buildBacktestReport(input);

      // Markdown assertions
      expect(output.markdown).toContain('| **Profit Factor** | **2.00** | Gross Profit: $400.00 / Gross Loss: $200.00 |');
      expect(output.markdown).toContain('| **Average Win / Loss** | **+4.00%** / **-2.00%** | Win/Loss Ratio: 2.00 |');
      expect(output.markdown).toContain('| **Win Rate** | **50.0%** | Long: 100.0% / Short: 0.0% |');

      // JSON assertions
      const summary = output.json.summary as Record<string, unknown>;
      expect(summary.profitFactor).toBe(2);
      expect(summary.profitFactorDisplay).toBe('2.00');
      expect(summary.winRate).toBe(0.5);
      expect((summary.long as Record<string, unknown>).winRate).toBe(1.0);
      expect((summary.short as Record<string, unknown>).winRate).toBe(0.0);
    });

    it('should correctly handle edge cases where denominators of reported breakdown metrics are zero', () => {
      const winTrade: Trade = {
        side: 'long',
        exitReason: 'signal',
        entrySignal: { action: 'BUY', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'SELL', price: 110, timestamp: candles[5].timestamp },
        entryPrice: 100,
        exitPrice: 110,
        quantity: 1,
        pnl: 1000,
        pnlPercent: 10.0,
        fee: 2,
        entryTime: candles[0].timestamp,
        exitTime: candles[5].timestamp,
        duration: 5,
        maxFavorablePercent: 12,
        maxAdversePercent: 1,
      };

      const input = makeReportInput([winTrade], {
        totalTrades: 1,
        winningTrades: 1,
        winRate: 1.0,
        totalPnl: 1000,
        totalPnlPercent: 10.0,
        averageWin: 10.0,
        long: { totalTrades: 1, winningTrades: 1, losingTrades: 0, winRate: 1.0, totalPnl: 1000, totalPnlPercent: 10.0 },
        short: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
      });

      const output = buildBacktestReport(input);

      expect(output.markdown).toContain('| **Short** | 0 | N/A | 0.00% | N/A | N/A | 0 bars |');
      expect(output.markdown).toContain('| **Long** | 1 | 100% | +10.00% | +10.00% | N/A | 5 bars |');

      const breakdowns = output.json.breakdowns as Record<string, { short: Record<string, unknown>; long: Record<string, unknown> }>;
      expect(breakdowns.side.short.pf).toBe('N/A');
      expect(breakdowns.side.short.winRate).toBe('N/A');
      expect(breakdowns.side.long.pf).toBe('N/A');
    });
  });

  describe('5. Signal and Rejection Accounting Invariants', () => {
    it('should strictly account for every TK cross: total = sum(rejections) + emitted signals', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 4,
        kijun: 8,
        senkouB: 16,
        displacement: 4,
        rsiPeriod: 7,
        rsiLookback: 5,
        cloudFilter: 'trend',
        kijunSlopeFilter: true,
        rsiRecoveryCap: 15,
      });

      const engine = new BacktestEngine();
      const backtestResult = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-short',
        collectTrace: true,
      });

      const output = buildBacktestReport({
        backtestResult,
        candles,
        config: {
          symbol: 'BTCUSDT',
          interval: '1h',
          cloudFilter: 'trend',
          kijunSlopeFilter: true,
          rsiRecoveryCap: 15,
        },
      });

      const trace = backtestResult.trace!;
      expect(trace).toBeDefined();

      const totalCrosses = trace.tkCrossEvents.length;
      const emittedSignals = trace.tkCrossEvents.filter((e) => e.signalEmitted).length;
      const rejectedCrosses = trace.tkCrossEvents.filter((e) => !e.signalEmitted);

      // Invariant 1: Total crosses = emitted signals + rejected crosses
      expect(totalCrosses).toBe(emittedSignals + rejectedCrosses.length);

      // Invariant 2: Every rejected cross has a recognized rejection reason
      const cloudRejections = rejectedCrosses.filter((e) => e.filterRejection === 'cloudFilter').length;
      const kijunRejections = rejectedCrosses.filter((e) => e.filterRejection === 'kijunSlopeFilter').length;
      const rsiZoneRejections = rejectedCrosses.filter((e) => e.filterRejection === 'rsiOutOfZone').length;
      const rsiCapRejections = rejectedCrosses.filter((e) => e.filterRejection === 'rsiRecoveryCap').length;

      expect(rejectedCrosses.length).toBe(
        cloudRejections + kijunRejections + rsiZoneRejections + rsiCapRejections
      );

      // Invariant 3: Funnel in JSON matches trace exactly
      const funnel = output.json.funnel as {
        tkCrossUpCount: number;
        tkCrossDownCount: number;
        crossUpInZone: number;
        crossDownInZone: number;
        buySignalsEmitted: number;
        sellSignalsEmitted: number;
        executedTradesTotal: number;
        rejections: {
          total: number;
          rsiOutOfZone: number;
          cloudFilter: number;
          rsiRecoveryCap: number;
          kijunSlopeFilter: number;
        };
        ignoredSignals: {
          total: number;
          alreadyInPosition: number;
          longOnlyShortIgnored: number;
        };
      };
      expect(funnel).not.toBeNull();
      expect(funnel.tkCrossUpCount + funnel.tkCrossDownCount).toBe(totalCrosses);
      expect(funnel.buySignalsEmitted + funnel.sellSignalsEmitted).toBe(emittedSignals);
      expect(funnel.rejections.total).toBe(rejectedCrosses.length);
      expect(funnel.rejections.cloudFilter).toBe(cloudRejections);
      expect(funnel.rejections.kijunSlopeFilter).toBe(kijunRejections);
      expect(funnel.rejections.rsiOutOfZone).toBe(rsiZoneRejections);
      expect(funnel.rejections.rsiRecoveryCap).toBe(rsiCapRejections);

      // Invariant 4: Markdown includes the counts
      expect(output.markdown).toContain(`**TK Crossover Events** | `);
      expect(output.markdown).toContain(`- **Rejected Crosses (Did Not Become Signals):** ${rejectedCrosses.length}`);
    });

    it('should clearly indicate missing trace when collectTrace is false without distorting report', () => {
      const strategy = new IchimokuRsiStrategy({ tenkan: 4, kijun: 8, senkouB: 16 });
      const engine = new BacktestEngine();
      const backtestResult = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        collectTrace: false,
      });

      const output = buildBacktestReport({
        backtestResult,
        candles,
        config: { symbol: 'BTCUSDT', interval: '1h' },
      });

      expect(output.json.funnel).toBeNull();
      expect(output.markdown).toContain('Trace data was not collected for this backtest run');
    });
  });

  describe('6. HISTORY.md Win Rate Fallback and Row Formatting (Step 2)', () => {
    it('formatHistoryWinRate formats N/A for zero trades and actual percentage for executed trades', () => {
      // Zero executed trades
      expect(formatHistoryWinRate(null, 0)).toBe('N/A');
      expect(formatHistoryWinRate(undefined, 0)).toBe('N/A');
      expect(formatHistoryWinRate(0, 0)).toBe('N/A');
      expect(formatHistoryWinRate(NaN, 0)).toBe('N/A');

      // Executed trades with zero wins
      expect(formatHistoryWinRate(0, 1)).toBe('0.0%');
      expect(formatHistoryWinRate(0, 5)).toBe('0.0%');

      // Executed trades with positive win rate
      expect(formatHistoryWinRate(0.5, 2)).toBe('50.0%');
      expect(formatHistoryWinRate(0.3333, 3)).toBe('33.3%');
      expect(formatHistoryWinRate(1.0, 10)).toBe('100.0%');
    });

    it('formatHistoryRow formats deterministic rows clearly distinguishing zero trades from zero winners', () => {
      const zeroTradeRow = formatHistoryRow({
        dateFormatted: '2026-10-17 14:00:00',
        commitShort: 'ccc9adb',
        confHash: 'f8e53fab',
        symIntPer: 'BTCUSDT / 1h / 6y',
        netReturnPercent: 0,
        totalTrades: 0,
        maxDrawdownPercent: 0,
        winRate: null,
        filename: 'report_zero.md',
      });
      expect(zeroTradeRow).toBe(
        '| 2026-10-17 14:00:00 | `ccc9adb` | `f8e53fab` | BTCUSDT / 1h / 6y | **0.00%** | 0 | 0.00% | N/A | [Report](history/report_zero.md) |'
      );

      const zeroWinRow = formatHistoryRow({
        dateFormatted: '2026-10-17 14:00:00',
        commitShort: 'ccc9adb',
        confHash: '0ab7c791',
        symIntPer: 'BTCUSDT / 1h / 6y',
        netReturnPercent: -2.5,
        totalTrades: 2,
        maxDrawdownPercent: 3.1,
        winRate: 0,
        filename: 'report_loss.md',
      });
      expect(zeroWinRow).toBe(
        '| 2026-10-17 14:00:00 | `ccc9adb` | `0ab7c791` | BTCUSDT / 1h / 6y | **-2.50%** | 2 | 3.10% | 0.0% | [Report](history/report_loss.md) |'
      );
    });
  });

  describe('7. Section J Breakdowns with Empty and Non-Empty Categories (Step 3)', () => {
    it('should display N/A in Markdown and null in JSON for empty cloud and RSI categories', () => {
      const insideTrade: Trade = {
        side: 'long',
        exitReason: 'signal',
        entrySignal: { action: 'BUY', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'SELL', price: 105, timestamp: candles[3].timestamp },
        entryPrice: 100,
        exitPrice: 105,
        quantity: 1,
        pnl: 500,
        pnlPercent: 5.0,
        fee: 2,
        entryTime: candles[0].timestamp,
        exitTime: candles[3].timestamp,
        duration: 3,
        maxFavorablePercent: 6,
        maxAdversePercent: 1,
        entryDiagnostics: {
          side: 'long',
          priceVsCloud: 'inside',
          tkCrossVsCloud: 'inside',
          cloudThicknessPercent: 1.5,
          rsiAtEntry: 55,
          rsiHitValue: 35,
          rsiHitAge: 2,
          kijunSlope: 0.5,
          atrPercentile: 50,
          distanceFromKijunAtr: 0.2,
          hourOfDayUtc: 12,
          dayOfWeek: 1,
        },
      };

      const input = makeReportInput([insideTrade], {
        totalTrades: 1,
        winningTrades: 1,
        losingTrades: 0,
        winRate: 1.0,
        totalPnl: 500,
        totalPnlPercent: 5.0,
        averageWin: 5.0,
        long: { totalTrades: 1, winningTrades: 1, losingTrades: 0, winRate: 1.0, totalPnl: 500, totalPnlPercent: 5.0 },
        short: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
      });

      const output = buildBacktestReport(input);

      // JSON Assertions
      const breakdowns = output.json.breakdowns as {
        priceVsCloud: Array<{
          position: string;
          count: number;
          winRate: number | null;
          avgPnl: number | null;
          long: { count: number; winRate: number | null; totalPnl: number };
          short: { count: number; winRate: number | null; totalPnl: number };
        }>;
        rsiBuckets: Array<{
          bucket: string;
          count: number;
          winRate: number | null;
          avgPnl: number | null;
        }>;
      };

      const aboveCloud = breakdowns.priceVsCloud.find((c) => c.position === 'above')!;
      expect(aboveCloud.count).toBe(0);
      expect(aboveCloud.winRate).toBeNull();
      expect(aboveCloud.avgPnl).toBeNull();
      expect(aboveCloud.long.winRate).toBeNull();
      expect(aboveCloud.short.winRate).toBeNull();

      const insideCloud = breakdowns.priceVsCloud.find((c) => c.position === 'inside')!;
      expect(insideCloud.count).toBe(1);
      expect(insideCloud.winRate).toBe(100);
      expect(insideCloud.avgPnl).toBe(5.0);
      expect(insideCloud.long.winRate).toBe(100);

      const emptyRsiBucket = breakdowns.rsiBuckets.find((b) => b.bucket === '[20, 30)')!;
      expect(emptyRsiBucket.count).toBe(0);
      expect(emptyRsiBucket.winRate).toBeNull();
      expect(emptyRsiBucket.avgPnl).toBeNull();

      const populatedRsiBucket = breakdowns.rsiBuckets.find((b) => b.bucket === '[50, 60)')!;
      expect(populatedRsiBucket.count).toBe(1);
      expect(populatedRsiBucket.winRate).toBe(100);
      expect(populatedRsiBucket.avgPnl).toBe(5.0);

      // Markdown Assertions
      expect(output.markdown).toContain('| `above` | 0 | N/A | 0.00% | N/A | 0 / N/A / 0.00% | 0 / N/A / 0.00% |');
      expect(output.markdown).toContain('| `below` | 0 | N/A | 0.00% | N/A | 0 / N/A / 0.00% | 0 / N/A / 0.00% |');
      expect(output.markdown).toContain('| `inside` | 1 | 100% | +5.00% | +5.00% | 1 / 100% / +5.00% | 0 / N/A / 0.00% |');

      expect(output.markdown).toContain('| `[20, 30)` | 0 | N/A | 0.00% | N/A |');
      expect(output.markdown).toContain('| `[50, 60)` | 1 | 100% | +5.00% | +5.00% |');
    });
  });

  describe('8. Section D Diagnostic Semantics Note (Step 4)', () => {
    it('should include clear diagnostic semantics note in Section D', () => {
      const strategy = new IchimokuRsiStrategy({ tenkan: 4, kijun: 8, senkouB: 16 });
      const engine = new BacktestEngine();
      const backtestResult = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        collectTrace: true,
      });

      const output = buildBacktestReport({
        backtestResult,
        candles,
        config: { symbol: 'BTCUSDT', interval: '1h' },
      });

      expect(output.markdown).toContain('Diagnostic Semantics:');
      expect(output.markdown).toContain(
        '**Crosses with RSI in Zone** reflects independent RSI lookback qualification across all candidate TK crossovers'
      );
      expect(output.markdown).toContain(
        '"Signal Attrition & Rejections" reflects exclusive first-rejection attribution in execution order'
      );
    });
  });

  describe('9. Section F Trajectory & Empty Sample Progression Audit', () => {
    it('should display N/A for empty trade samples in Section F header and progression table', () => {
      const input = makeReportInput([]);
      const output = buildBacktestReport(input);

      // Section F header on zero trades
      expect(output.markdown).toContain('- **Trades Rebounding After Drawdown:** 0 (N/A)');
      expect(output.markdown).toContain('- **Permanently Underwater Trades:** 0 (N/A)');

      // Section F progression table rows on zero trades
      for (const bar of [1, 3, 6, 12, 24, 48, 96]) {
        expect(output.markdown).toContain(`| **Bar ${bar}** | N/A (0 trades) | N/A | N/A |`);
      }
    });

    it('should display valid percentages for populated categories and N/A for empty categories in Section F', () => {
      const winTrade: Trade = {
        side: 'long',
        exitReason: 'takeProfit',
        entrySignal: { action: 'BUY', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'SELL', price: 105, timestamp: candles[5].timestamp },
        entryPrice: 100,
        exitPrice: 105,
        quantity: 1,
        pnl: 500,
        pnlPercent: 5.0,
        fee: 1,
        entryTime: candles[0].timestamp,
        exitTime: candles[5].timestamp,
        duration: 5,
        maxFavorablePercent: 6,
        maxAdversePercent: 0.5,
      };

      const input = makeReportInput([winTrade], {
        totalTrades: 1,
        winningTrades: 1,
        winRate: 1.0,
        long: { totalTrades: 1, winningTrades: 1, losingTrades: 0, winRate: 1.0, totalPnl: 500, totalPnlPercent: 5.0 },
      });

      const output = buildBacktestReport(input);

      // Non-empty header stats for 1 trade
      expect(output.markdown).toContain('- **Trades Rebounding After Drawdown:** 0 (0%)');
      expect(output.markdown).toContain('- **Permanently Underwater Trades:** 0 (0%)');

      // Bars 1 and 3 are within holding duration (5 bars)
      // Winning trades column is populated; Losing trades column must be N/A
      expect(output.markdown).toMatch(/\| \*\*Bar 1\*\* \| [+-]?[0-9.]+%\s*\(1 trades\) \| [+-]?[0-9.]+%\s*\| N\/A \|/);
      expect(output.markdown).toMatch(/\| \*\*Bar 3\*\* \| [+-]?[0-9.]+%\s*\(1 trades\) \| [+-]?[0-9.]+%\s*\| N\/A \|/);

      // Bar 6, 12, etc. exceed holding duration (5 bars), so all columns are N/A
      expect(output.markdown).toContain('| **Bar 6** | N/A (0 trades) | N/A | N/A |');
      expect(output.markdown).toContain('| **Bar 12** | N/A (0 trades) | N/A | N/A |');
    });

    it('should preserve legitimate numeric 0.00% when a non-empty sample produces an average PnL of zero', () => {
      const customCandles: Candle[] = [
        createCandle(0, 100, 105, 95, 100),
        createCandle(1, 100, 105, 95, 100), // Bar 1: close = 100 -> unrealized PnL = 0.00%
        createCandle(2, 100, 105, 95, 100),
        createCandle(3, 100, 106, 95, 105), // Exit candle
      ];

      const zeroTrade: Trade = {
        side: 'long',
        exitReason: 'takeProfit',
        entrySignal: { action: 'BUY', price: 100, timestamp: customCandles[0].timestamp },
        exitSignal: { action: 'SELL', price: 105, timestamp: customCandles[3].timestamp },
        entryPrice: 100,
        exitPrice: 105,
        quantity: 1,
        pnl: 500,
        pnlPercent: 5.0,
        fee: 1,
        entryTime: customCandles[0].timestamp,
        exitTime: customCandles[3].timestamp,
        duration: 3,
        maxFavorablePercent: 5.0,
        maxAdversePercent: 0.0,
      };

      const input: BacktestReportInput = {
        backtestResult: {
          config: { strategy: new IchimokuRsiStrategy(), initialBalance: 10000 },
          trades: [zeroTrade],
          metrics: {
            ...baseMetrics,
            totalTrades: 1,
            winningTrades: 1,
            winRate: 1.0,
            long: { totalTrades: 1, winningTrades: 1, losingTrades: 0, winRate: 1.0, totalPnl: 500, totalPnlPercent: 5.0 },
          },
          equity: [10000, 10500],
        },
        candles: customCandles,
        config: { symbol: 'BTCUSDT', interval: '1h', initialBalance: 10000 },
      };

      const output = buildBacktestReport(input);

      // Bar 1 should be exactly 0.00% (not N/A) for All Trades and Winning Trades, and N/A for Losing Trades
      expect(output.markdown).toContain('| **Bar 1** | 0.00% (1 trades) | 0.00% | N/A |');
      // Bar 6 was not reached, so it should be N/A
      expect(output.markdown).toContain('| **Bar 6** | N/A (0 trades) | N/A | N/A |');
    });
  });

  describe('10. Section H Open Trade at Backtest Conclusion Audit', () => {
    it('should report no trades executed and no forced liquidation required when trade sample is empty', () => {
      const input = makeReportInput([]);
      const output = buildBacktestReport(input);

      expect(output.markdown).toContain(
        'ℹ️ **No trades executed.** No trades were executed, no positions were opened, and no forced liquidation was required.'
      );
      expect(output.markdown).not.toContain('No forced exit at backtest conclusion');
      expect(output.markdown).not.toContain('Ongoing / Forced Exit Active at End of Data');
    });

    it('should report natural exits when trades exist with normal exit reason', () => {
      const normalTrade: Trade = {
        side: 'long',
        exitReason: 'takeProfit',
        entrySignal: { action: 'BUY', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'SELL', price: 105, timestamp: candles[5].timestamp },
        entryPrice: 100,
        exitPrice: 105,
        quantity: 1,
        pnl: 500,
        pnlPercent: 5.0,
        fee: 1,
        entryTime: candles[0].timestamp,
        exitTime: candles[5].timestamp,
        duration: 5,
        maxFavorablePercent: 6,
        maxAdversePercent: 0.5,
      };

      const input = makeReportInput([normalTrade], {
        totalTrades: 1,
        winningTrades: 1,
        winRate: 1.0,
        long: { totalTrades: 1, winningTrades: 1, losingTrades: 0, winRate: 1.0, totalPnl: 500, totalPnlPercent: 5.0 },
      });

      const output = buildBacktestReport(input);

      expect(output.markdown).toContain(
        '✅ **No forced exit at backtest conclusion.** Portfolio finished in 100% cash with all positions exited through regular strategy signals or stops.'
      );
      expect(output.markdown).not.toContain('No trades executed');
      expect(output.markdown).not.toContain('Ongoing / Forced Exit Active at End of Data');
    });

    it('should report forced exit segregation when final trade has exitReason "end"', () => {
      const endTrade: Trade = {
        side: 'short',
        exitReason: 'end',
        entrySignal: { action: 'SELL', price: 100, timestamp: candles[0].timestamp },
        exitSignal: { action: 'BUY', price: 102, timestamp: candles[5].timestamp },
        entryPrice: 100,
        exitPrice: 102,
        quantity: 1,
        pnl: -200,
        pnlPercent: -2.0,
        fee: 1,
        entryTime: candles[0].timestamp,
        exitTime: candles[5].timestamp,
        duration: 5,
        maxFavorablePercent: 1.0,
        maxAdversePercent: 2.5,
      };

      const input = makeReportInput([endTrade], {
        totalTrades: 1,
        losingTrades: 1,
        winRate: 0.0,
        short: { totalTrades: 1, winningTrades: 0, losingTrades: 1, winRate: 0.0, totalPnl: -200, totalPnlPercent: -2.0 },
      });

      const output = buildBacktestReport(input);

      expect(output.markdown).toContain('⚠️ **Ongoing / Forced Exit Active at End of Data**');
      expect(output.markdown).toContain(
        'The backtest finished with an open position that was forcibly liquidated on the final candle close.'
      );
      expect(output.markdown).toContain('Forced Trade:');
      expect(output.markdown).not.toContain('No forced exit at backtest conclusion');
      expect(output.markdown).not.toContain('No trades executed');
    });
  });
});

