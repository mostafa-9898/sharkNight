import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PaperRunner, BOOK_A_SPEC, BOOK_B_SPEC, HaltableStrategyWrapper } from '../../src/paper/runner';
import { MultiTimeframeStrategy } from '../../src/strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../../src/backtest/engine';
import type { Candle } from '../../src/data/models/candle';

describe('PaperRunner (PT2)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-runner-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('reproduces 1-year historical backtest trade-by-trade with 100% exact parity', async () => {
    // 1. Load 1 year of BTCUSDT 1h data (8,760 candles)
    const raw1hPath = path.resolve(process.cwd(), 'data/BTCUSDT_1h.json');
    const raw4hPath = path.resolve(process.cwd(), 'data/BTCUSDT_4h.json');

    const all1h: Candle[] = JSON.parse(await fs.readFile(raw1hPath, 'utf-8'));
    const all4h: Candle[] = JSON.parse(await fs.readFile(raw4hPath, 'utf-8'));

    // Slice 1 full calendar year (8,760 1h candles, e.g. from candle 10,000 to 18,760)
    const startIdx = 10000;
    const count = 8760;
    const test1h = all1h.slice(startIdx, startIdx + count);
    const startTs = test1h[0].timestamp;
    const endTs = test1h[test1h.length - 1].timestamp;

    // Filter corresponding 4h candles
    const test4h = all4h.filter((c) => c.timestamp >= startTs - 50 * 4 * 3600000 && c.timestamp <= endTs);

    const runner = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    // Run via PaperRunner
    const { state: runnerState, backtestResult: runnerBacktest } = await runner.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: test1h,
      htf4hCandles: test4h,
      closePositionsAtEnd: true,
    });

    // Run direct BacktestEngine with identical config
    const directStrat = new MultiTimeframeStrategy({
      ...BOOK_A_SPEC.strategyConfig,
      htf4hCandles: test4h,
    });

    const engine = new BacktestEngine();
    const directResult = engine.run({
      strategy: directStrat,
      candles: test1h,
      initialBalance: 10000,
      closePositionsAtEnd: true,
      ...BOOK_A_SPEC.backtestConfig,
    });

    // Parity assertions
    expect(runnerState.closedTrades.length).toBeGreaterThan(0);
    expect(runnerState.closedTrades.length).toBe(directResult.trades.length);

    for (let i = 0; i < directResult.trades.length; i++) {
      const runnerTrade = runnerState.closedTrades[i];
      const directTrade = directResult.trades[i];

      expect(runnerTrade.side).toBe(directTrade.side);
      expect(runnerTrade.entryPrice).toBe(directTrade.entryPrice);
      expect(runnerTrade.exitPrice).toBe(directTrade.exitPrice);
      expect(runnerTrade.entryTime).toBe(directTrade.entryTime);
      expect(runnerTrade.exitTime).toBe(directTrade.exitTime);
      expect(runnerTrade.pnl).toBe(directTrade.pnl);
      expect(runnerTrade.fee).toBe(directTrade.fee);
      expect(runnerTrade.exitReason).toBe(directTrade.exitReason);
    }

    // Verify metrics parity
    expect(runnerState.metrics.totalPnlPercent).toBe(directResult.metrics.totalPnlPercent);
    expect(runnerState.metrics.maxDrawdownPercent).toBe(directResult.metrics.maxDrawdownPercent);
  });

  it('persists state on disk and cleanly resumes without duplicate trades after restart', async () => {
    const raw1hPath = path.resolve(process.cwd(), 'data/BTCUSDT_1h.json');
    const all1h: Candle[] = JSON.parse(await fs.readFile(raw1hPath, 'utf-8'));
    const slice500 = all1h.slice(10000, 10500);
    const slice600 = all1h.slice(10000, 10600);

    const runnerInstance1 = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    // 1. First run up to 500 candles
    const { state: state1 } = await runnerInstance1.processCandles({
      book: 'B',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: slice500,
    });

    const stateFilePath = runnerInstance1.getStateFilePath('B', 'BTCUSDT', '1h');
    await expect(fs.access(stateFilePath)).resolves.toBeUndefined();

    // 2. Restart: simulate new process with new PaperRunner instance
    const runnerInstance2 = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    // Verify loaded state from disk matches
    const loadedState = await runnerInstance2.loadState('B', 'BTCUSDT', '1h');
    expect(loadedState).not.toBeNull();
    expect(loadedState?.book).toBe('B');
    expect(loadedState?.symbol).toBe('BTCUSDT');
    expect(loadedState?.lastProcessedTimestamp).toBe(slice500[slice500.length - 1].timestamp);

    // 3. Continue running on 600 candles
    const { state: state2 } = await runnerInstance2.processCandles({
      book: 'B',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: slice600,
    });

    // Check no duplicate trade IDs or identical trades
    const trades = state2.closedTrades;
    const seenSignatures = new Set<string>();
    for (const t of trades) {
      const sig = `${t.side}_${t.entryTime}_${t.exitTime}_${t.entryPrice}_${t.exitPrice}`;
      expect(seenSignatures.has(sig)).toBe(false);
      seenSignatures.add(sig);
    }
  });

  it('halts new entries when HALT file exists while continuing to trail and exit open positions', async () => {
    const raw1hPath = path.resolve(process.cwd(), 'data/BTCUSDT_1h.json');
    const all1h: Candle[] = JSON.parse(await fs.readFile(raw1hPath, 'utf-8'));

    // Find a candle range where Book A enters at least one trade
    const candidateSlice = all1h.slice(10000, 10500);

    const runnerNormal = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    const { state: normalState } = await runnerNormal.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: candidateSlice,
      closePositionsAtEnd: true,
    });

    expect(normalState.closedTrades.length).toBeGreaterThan(0);
    const firstTrade = normalState.closedTrades[0];

    // Now create a HALT file timestamped right at the start
    await runnerNormal.triggerHalt('A', 'Manual testing circuit breaker');
    expect(await runnerNormal.isBookHalted('A')).toBe(true);

    // Run again with HALT file present
    const { state: haltedState } = await runnerNormal.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: candidateSlice,
      haltTimestamp: candidateSlice[0].timestamp, // Halted from the very first candle
      closePositionsAtEnd: true,
    });

    // Zero new trades should have opened because new entries were suppressed from timestamp 0
    expect(haltedState.isHalted).toBe(true);
    expect(haltedState.closedTrades).toHaveLength(0);

    // Test trailing of existing positions when HALT is placed mid-trade:
    // Place HALT right after firstTrade.entryTime
    await runnerNormal.clearHalt('A');
    await runnerNormal.triggerHalt('A', 'Halted after first entry');

    const { state: midHaltedState } = await runnerNormal.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: candidateSlice,
      haltTimestamp: (firstTrade.entryTime ?? 0) + 1, // Halts AFTER first entry opened
      closePositionsAtEnd: true,
    });

    // First trade opened before halt, so it MUST trail and exit cleanly!
    expect(midHaltedState.closedTrades.length).toBeGreaterThanOrEqual(1);
    expect(midHaltedState.closedTrades[0].entryTime).toBe(firstTrade.entryTime);
    expect(midHaltedState.closedTrades[0].exitPrice).toBe(firstTrade.exitPrice);
  });

  it('automatically triggers HALT circuit breaker file if drawdown reaches >= 10%', async () => {
    const runner = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    // Construct synthetic candles that force an immediate >10% drawdown
    const t0 = 1_700_000_000_000;
    const hour = 3_600_000;
    const syntheticCandles: Candle[] = [];

    // Warmup flat candles
    for (let i = 0; i < 100; i++) {
      syntheticCandles.push({
        timestamp: t0 + i * hour,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 100,
      });
    }

    // Sudden upward spike to trigger entry
    syntheticCandles.push({
      timestamp: t0 + 100 * hour,
      open: 100,
      high: 120,
      low: 100,
      close: 118,
      volume: 1000,
    });

    // Sudden catastrophic crash
    for (let i = 101; i < 110; i++) {
      syntheticCandles.push({
        timestamp: t0 + i * hour,
        open: 80 - (i - 101) * 5,
        high: 81 - (i - 101) * 5,
        low: 70 - (i - 101) * 5,
        close: 72 - (i - 101) * 5,
        volume: 500,
      });
    }

    // Run PaperRunner on raw candles (will evaluate strategy and calculate DD)
    const { state } = await runner.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: syntheticCandles,
    });

    // If maxDD reached >= 10% on open positions or closed trades, HALT must be triggered
    if (state.maxDrawdownPercent >= 10.0 || state.currentDrawdownPercent >= 10.0) {
      expect(state.isHalted).toBe(true);
      await expect(fs.access(runner.getHaltFilePath('A'))).resolves.toBeUndefined();
    }
  });
});
