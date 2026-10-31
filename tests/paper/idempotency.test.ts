import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PaperRunner } from '../../src/paper/runner';
import type { Candle } from '../../src/data/models';

describe('Paper Trading Idempotency & Forward Testing Invariants (PU3)', () => {
  let tempDir: string;
  let all1h: Candle[];
  let all4h: Candle[];

  beforeAll(async () => {
    const raw1h = path.resolve(process.cwd(), 'data/BTCUSDT_1h.json');
    const raw4h = path.resolve(process.cwd(), 'data/BTCUSDT_4h.json');
    all1h = JSON.parse(await fs.readFile(raw1h, 'utf-8'));
    all4h = JSON.parse(await fs.readFile(raw4h, 'utf-8'));
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-idempotency-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('(a) Re-running or restarting on identical data produces 100% byte-for-byte identical state JSON files', async () => {
    const runner1 = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    const slice = all1h.slice(10000, 11000);
    const startTs = slice[0].timestamp;
    const endTs = slice[slice.length - 1].timestamp;
    const htf4h = all4h.filter((c) => c.timestamp >= startTs - 50 * 4 * 3600000 && c.timestamp <= endTs);

    // Initial forward epoch at candle 500
    const forwardEpoch = slice[500].timestamp;
    await runner1.initForwardStart(forwardEpoch);

    // Run first time
    await runner1.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: slice,
      htf4hCandles: htf4h,
      forwardStartTimestamp: forwardEpoch,
    });

    const statePath = runner1.getStateFilePath('A', 'BTCUSDT', '1h');
    const firstOutputBytes = await fs.readFile(statePath);

    // Simulate restart with fresh PaperRunner instance
    const runner2 = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    // Run second time on identical data
    await runner2.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: slice,
      htf4hCandles: htf4h,
      forwardStartTimestamp: forwardEpoch,
    });

    const secondOutputBytes = await fs.readFile(statePath);

    // Assert exact byte-for-byte identity
    expect(firstOutputBytes.equals(secondOutputBytes)).toBe(true);
    expect(firstOutputBytes.toString('utf-8')).toBe(secondOutputBytes.toString('utf-8'));
  });

  it('(b) Adding new candles to growing window preserves prior closed trades without retroactive modification', async () => {
    const runner = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    const batch1 = all1h.slice(10000, 10800);
    const batch2 = all1h.slice(10000, 10900); // 100 additional candles

    const forwardEpoch = batch1[200].timestamp;
    await runner.initForwardStart(forwardEpoch);

    // Run on batch 1
    const { state: state1 } = await runner.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: batch1,
      forwardStartTimestamp: forwardEpoch,
    });

    const trades1 = state1.closedTrades;
    expect(trades1.length).toBeGreaterThan(0);

    // Run on batch 2 (growing window)
    const { state: state2 } = await runner.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: batch2,
      forwardStartTimestamp: forwardEpoch,
    });

    const trades2 = state2.closedTrades;
    expect(trades2.length).toBeGreaterThanOrEqual(trades1.length);

    // All trades that were already closed in batch 1 must be identical in batch 2
    for (let i = 0; i < trades1.length; i++) {
      const t1 = trades1[i];
      const t2 = trades2[i];

      expect(t2.side).toBe(t1.side);
      expect(t2.entryTime).toBe(t1.entryTime);
      expect(t2.entryPrice).toBe(t1.entryPrice);
      expect(t2.exitTime).toBe(t1.exitTime);
      expect(t2.exitPrice).toBe(t1.exitPrice);
      expect(t2.pnl).toBe(t1.pnl);
      expect(t2.fee).toBe(t1.fee);
      expect(t2.exitReason).toBe(t1.exitReason);
    }
  });

  it('(c) StartGate ensures ZERO trades have entryTime < forwardStartTimestamp', async () => {
    const runner = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    // Run with Book A and Book B on 1,500 candles
    const slice = all1h.slice(10000, 11500);

    // Epoch placed at candle 800
    const epochCandle = slice[800];
    const forwardEpoch = epochCandle.timestamp;
    await runner.initForwardStart(forwardEpoch);

    for (const book of ['A', 'B'] as const) {
      const { state } = await runner.processCandles({
        book,
        symbol: 'BTCUSDT',
        interval: '1h',
        candles: slice,
        forwardStartTimestamp: forwardEpoch,
      });

      // Forward trades must exist
      expect(state.closedTrades.length).toBeGreaterThan(0);

      // Verify every single trade entered AT OR AFTER the forward epoch
      for (const trade of state.closedTrades) {
        expect(trade.entryTime).toBeGreaterThanOrEqual(forwardEpoch);
      }

      // Verify open positions entered AT OR AFTER the forward epoch
      for (const pos of state.openPositions) {
        expect(pos.entryTime).toBeGreaterThanOrEqual(forwardEpoch);
      }
    }
  });

  it('(d) HALT circuit breaker timestamp is stored persistently from file JSON, immune to filesystem mtime', async () => {
    const runner = new PaperRunner({
      dataDir: tempDir,
      initialBalance: 10000,
    });

    const fixedHaltTimestamp = 1730380000000;
    await runner.triggerHalt('A', 'Manual risk cutoff', fixedHaltTimestamp);

    // Verify HALT file content
    const haltRaw = await fs.readFile(runner.getHaltFilePath('A'), 'utf-8');
    const haltJson = JSON.parse(haltRaw);
    expect(haltJson.haltedAt).toBe(fixedHaltTimestamp);
    expect(haltJson.reason).toBe('Manual risk cutoff');

    const slice = all1h.slice(10000, 10500);
    const { state } = await runner.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: slice,
      forwardStartTimestamp: slice[0].timestamp,
    });

    expect(state.isHalted).toBe(true);
    expect(state.haltedAt).toBe(fixedHaltTimestamp);
    expect(state.haltReason).toBe('Manual risk cutoff');
  });
});
