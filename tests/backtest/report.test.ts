import { BacktestEngine } from '@/backtest/engine';
import { IchimokuRsiStrategy } from '@/strategies/ichimoku-rsi-strategy';
import {
  buildBacktestReport,
  computeDrawdownPeriods,
  computeTradeTrajectories,
  type BacktestReportInput,
} from '@/backtest/report';
import type { Candle } from '@/data/models/candle';

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
});

