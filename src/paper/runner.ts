import * as fs from 'fs/promises';
import * as path from 'path';
import type { Candle, CandleInterval, TradeSignal } from '../data/models';
import type { Strategy } from '../strategies/types';
import { MultiTimeframeStrategy, type MultiTimeframeConfig } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import type {
  BacktestConfig,
  BacktestResult,
  Trade,
  ActivePosition,
  BacktestMetrics,
  ExitMode,
  TradeSide,
  SignalFunnel,
} from '../backtest/types';
import { roundTo } from '../utils/math';

export type PaperBook = 'A' | 'B';

export interface PaperRunnerOptions {
  dataDir?: string;
  initialBalance?: number;
}

export interface ForwardClock {
  forwardStartTimestamp: number;
  iso: string;
  note: string;
}

export interface PaperMarketState {
  book: PaperBook;
  symbol: string;
  interval: CandleInterval;
  initialBalance: number;
  cash: number;
  equity: number;
  peakEquity: number;
  currentDrawdownPercent: number;
  maxDrawdownPercent: number;
  isHalted: boolean;
  haltReason?: string | null;
  haltedAt?: number | null;
  forwardStartTimestamp?: number;
  lastProcessedTimestamp: number;
  openPositions: ActivePosition[];
  closedTrades: Trade[];
  metrics: BacktestMetrics;
  signalFunnel?: SignalFunnel;
  updatedAt: number;
}

export interface BookSpec {
  book: PaperBook;
  name: string;
  strategyConfig: Partial<MultiTimeframeConfig>;
  backtestConfig: Partial<BacktestConfig>;
}

export const BOOK_A_SPEC: BookSpec = {
  book: 'A',
  name: 'F3 Active',
  strategyConfig: {
    htfMode: 'strict',
    entryMode: 'cross',
    fisherMode: 'confirm',
    kijunSlopeFilter: true,
    structureFilter: true,
    stochKPeriod: 14,
    stochDPeriod: 3,
    stochSmooth: 3,
    stochOversold: 30,
    stochOverbought: 70,
  },
  backtestConfig: {
    tradeMode: 'long-only',
    exitMode: 'trailingOnly',
    positionSizePercent: 3,
    maxOpenPositions: 10,
    maxTotalExposurePercent: 30,
    trailingStop: {
      initialStopPercent: 5,
      stepPercent: 3,
      raisePercent: 1.5,
      mode: 'stepped',
    },
    tradeFeePercent: 0.1,
    slippagePercent: 0.05,
    entryFill: 'nextOpen',
    entrySlippagePercent: 0.05,
    allowOppositePositions: true,
  },
};

export const BOOK_B_SPEC: BookSpec = {
  book: 'B',
  name: 'C1L Conservative',
  strategyConfig: {
    htfMode: 'strict',
    entryMode: 'cross',
    fisherMode: 'extra-trigger',
    kijunSlopeFilter: true,
    structureFilter: true,
    stochKPeriod: 14,
    stochDPeriod: 3,
    stochSmooth: 3,
    stochOversold: 30,
    stochOverbought: 70,
  },
  backtestConfig: {
    tradeMode: 'long-only',
    exitMode: 'trailingOnly',
    positionSizePercent: 2,
    maxOpenPositions: 5,
    maxTotalExposurePercent: 20,
    trailingStop: {
      initialStopPercent: 5,
      stepPercent: 3,
      raisePercent: 1.5,
      mode: 'stepped',
    },
    tradeFeePercent: 0.1,
    slippagePercent: 0.05,
    entryFill: 'nextOpen',
    entrySlippagePercent: 0.05,
    allowOppositePositions: true,
  },
};

/**
 * Strategy wrapper that blocks new entry signals before the forward clock epoch,
 * ensuring the paper trading account starts completely flat and in 100% cash
 * at forwardStartTimestamp.
 */
export class StartGateStrategyWrapper implements Strategy {
  readonly inner: Strategy;
  readonly forwardStartTimestamp: number;

  constructor(inner: Strategy, forwardStartTimestamp: number) {
    this.inner = inner;
    this.forwardStartTimestamp = forwardStartTimestamp;
  }

  get name(): string {
    return `StartGate(${this.inner.name})`;
  }

  get description(): string {
    return this.inner.description;
  }

  get requiredCandles(): number {
    return this.inner.requiredCandles;
  }

  analyze(candles: readonly Candle[], index: number): TradeSignal {
    const candle = candles[index];
    if (this.forwardStartTimestamp > 0 && candle.timestamp < this.forwardStartTimestamp) {
      return {
        action: 'HOLD',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: 'StartGate active: warm-up entries suppressed',
      };
    }
    return this.inner.analyze(candles, index);
  }

  exitSignal(
    candles: readonly Candle[],
    index: number,
    side: TradeSide,
    mode: ExitMode
  ): boolean {
    if (typeof this.inner.exitSignal === 'function') {
      return this.inner.exitSignal(candles, index, side, mode);
    }
    return false;
  }
}

/**
 * Strategy wrapper that blocks new entry signals if HALT circuit breaker is active,
 * while allowing trailing stop exits and position management to proceed unaffected.
 */
export class HaltableStrategyWrapper implements Strategy {
  readonly inner: Strategy;
  private readonly isHaltedFn: (timestamp: number) => boolean;

  constructor(inner: Strategy, isHaltedFn: (timestamp: number) => boolean) {
    this.inner = inner;
    this.isHaltedFn = isHaltedFn;
  }

  get name(): string {
    return `Haltable(${this.inner.name})`;
  }

  get description(): string {
    return this.inner.description;
  }

  get requiredCandles(): number {
    return this.inner.requiredCandles;
  }

  analyze(candles: readonly Candle[], index: number): TradeSignal {
    const candle = candles[index];
    if (this.isHaltedFn(candle.timestamp)) {
      return {
        action: 'HOLD',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: 'HALT circuit breaker active: new entries suppressed',
      };
    }
    return this.inner.analyze(candles, index);
  }

  exitSignal(
    candles: readonly Candle[],
    index: number,
    side: TradeSide,
    mode: ExitMode
  ): boolean {
    if (typeof this.inner.exitSignal === 'function') {
      return this.inner.exitSignal(candles, index, side, mode);
    }
    return false;
  }
}

export class PaperRunner {
  readonly dataDir: string;
  readonly initialBalance: number;
  private readonly engine: BacktestEngine;

  constructor(options?: PaperRunnerOptions) {
    this.dataDir = options?.dataDir ?? path.resolve(process.cwd(), 'data/paper');
    this.initialBalance = options?.initialBalance ?? 10000;
    this.engine = new BacktestEngine();
  }

  getStateFilePath(book: PaperBook, symbol: string, interval: CandleInterval): string {
    const cleanSym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return path.join(this.dataDir, `state_${book}_${cleanSym}_${interval}.json`);
  }

  getHaltFilePath(book: PaperBook): string {
    return path.join(this.dataDir, `HALT_${book}`);
  }

  getForwardStartFilePath(): string {
    return path.join(this.dataDir, 'forward_start.json');
  }

  async getForwardClock(): Promise<ForwardClock | null> {
    const filePath = this.getForwardStartFilePath();
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed.forwardStartTimestamp === 'number') {
        return parsed as ForwardClock;
      }
      return null;
    } catch {
      return null;
    }
  }

  async initForwardStart(timestamp?: number): Promise<ForwardClock> {
    const existing = await this.getForwardClock();
    if (existing) {
      return existing; // Immutable: if exists, do not overwrite!
    }
    const ts = timestamp ?? Date.now();
    const clock: ForwardClock = {
      forwardStartTimestamp: ts,
      iso: new Date(ts).toISOString(),
      note: 'Immutable forward testing epoch',
    };
    const filePath = this.getForwardStartFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(clock, null, 2) + '\n', 'utf-8');
    return clock;
  }

  async getOrInitForwardStart(timestamp?: number): Promise<ForwardClock> {
    const existing = await this.getForwardClock();
    if (existing) {
      return existing;
    }
    return this.initForwardStart(timestamp);
  }

  async isBookHalted(book: PaperBook): Promise<boolean> {
    const haltInfo = await this.getHaltInfo(book);
    return haltInfo.isHalted;
  }

  async getHaltInfo(book: PaperBook): Promise<{ isHalted: boolean; reason: string | null; haltedAt: number | null }> {
    const haltPath = this.getHaltFilePath(book);
    try {
      const raw = await fs.readFile(haltPath, 'utf-8');
      try {
        const parsed = JSON.parse(raw);
        return {
          isHalted: true,
          reason: parsed.reason ?? 'HALT circuit breaker active',
          haltedAt: typeof parsed.haltedAt === 'number' ? parsed.haltedAt : null,
        };
      } catch {
        const stat = await fs.stat(haltPath);
        return {
          isHalted: true,
          reason: raw.trim() || 'HALT circuit breaker active',
          haltedAt: stat.mtimeMs,
        };
      }
    } catch {
      return {
        isHalted: false,
        reason: null,
        haltedAt: null,
      };
    }
  }

  async triggerHalt(book: PaperBook, reason: string, haltedAt?: number): Promise<void> {
    const haltPath = this.getHaltFilePath(book);
    await fs.mkdir(this.dataDir, { recursive: true });
    const ts = haltedAt ?? Date.now();
    const content = JSON.stringify(
      {
        book,
        reason,
        haltedAt: ts,
        iso: new Date(ts).toISOString(),
      },
      null,
      2
    ) + '\n';
    await fs.writeFile(haltPath, content, 'utf-8');
  }

  async clearHalt(book: PaperBook): Promise<void> {
    const haltPath = this.getHaltFilePath(book);
    try {
      await fs.unlink(haltPath);
    } catch {
      // Ignore if not present
    }
  }

  async loadState(
    book: PaperBook,
    symbol: string,
    interval: CandleInterval
  ): Promise<PaperMarketState | null> {
    const filePath = this.getStateFilePath(book, symbol, interval);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as PaperMarketState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new Error(`Failed to load paper state from ${filePath}: ${(err as Error).message}`);
    }
  }

  async saveState(state: PaperMarketState): Promise<string> {
    const filePath = this.getStateFilePath(state.book, state.symbol, state.interval);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    await fs.rename(tempPath, filePath);
    return filePath;
  }

  /**
   * Evaluates a paper trading book on given candles.
   * Directly uses MultiTimeframeStrategy and BacktestEngine.
   */
  async processCandles(params: {
    book: PaperBook;
    symbol: string;
    interval: CandleInterval;
    candles: readonly Candle[];
    htf1hCandles?: readonly Candle[];
    htf4hCandles?: readonly Candle[];
    closePositionsAtEnd?: boolean;
    haltTimestamp?: number;
    forwardStartTimestamp?: number;
  }): Promise<{ state: PaperMarketState; backtestResult: BacktestResult }> {
    const { book, symbol, interval, candles, htf1hCandles, htf4hCandles } = params;
    const closePositionsAtEnd = params.closePositionsAtEnd ?? false;

    if (candles.length === 0) {
      throw new Error('Cannot process empty candle sequence in PaperRunner');
    }

    const spec = book === 'A' ? BOOK_A_SPEC : BOOK_B_SPEC;

    // Resolve forwardStartTimestamp
    let forwardStartTimestamp = params.forwardStartTimestamp;
    if (forwardStartTimestamp === undefined) {
      const clock = await this.getForwardClock();
      if (clock) {
        forwardStartTimestamp = clock.forwardStartTimestamp;
      } else {
        forwardStartTimestamp = 0;
      }
    }

    // Resolve HALT status
    let haltInfo = await this.getHaltInfo(book);
    if (params.haltTimestamp !== undefined) {
      haltInfo = {
        isHalted: true,
        reason: haltInfo.reason ?? 'Halted via parameter',
        haltedAt: params.haltTimestamp,
      };
    }

    // 1. Construct the raw strategy
    const rawStrategy = new MultiTimeframeStrategy({
      ...spec.strategyConfig,
      htf1hCandles,
      htf4hCandles,
    });

    // 2. Wrap with StartGateStrategyWrapper if forwardStartTimestamp is active
    const startGatedStrategy =
      forwardStartTimestamp > 0
        ? new StartGateStrategyWrapper(rawStrategy, forwardStartTimestamp)
        : rawStrategy;

    // 3. Wrap with HaltableStrategyWrapper if HALT applies
    const strategy = new HaltableStrategyWrapper(startGatedStrategy, (t: number) => {
      if (haltInfo.isHalted) {
        if (haltInfo.haltedAt === null || haltInfo.haltedAt === undefined) {
          return true;
        }
        return t >= haltInfo.haltedAt;
      }
      return false;
    });

    // 4. Run shared BacktestEngine with nextOpen entryFill
    const backtestConfig: BacktestConfig = {
      strategy,
      candles,
      initialBalance: this.initialBalance,
      closePositionsAtEnd,
      ...spec.backtestConfig,
      entryFill: 'nextOpen',
      entrySlippagePercent: 0.05,
    };

    const backtestResult = this.engine.run(backtestConfig);

    // 5. Calculate peak equity and drawdown
    let peakEquity = this.initialBalance;
    for (const eq of backtestResult.equity) {
      if (eq > peakEquity) {
        peakEquity = eq;
      }
    }

    const latestEquity = backtestResult.equity[backtestResult.equity.length - 1];
    const currentDrawdownPercent =
      peakEquity > 0 ? roundTo(((peakEquity - latestEquity) / peakEquity) * 100, 2) : 0;

    const lastCandle = candles[candles.length - 1];

    // 6. Emergency circuit breaker check: DD >= 10.0%
    if (currentDrawdownPercent >= 10.0 && !haltInfo.isHalted) {
      const haltReason = `Drawdown reached ${currentDrawdownPercent}% >= 10.0% circuit breaker`;
      const haltedAt = lastCandle.timestamp;
      haltInfo = {
        isHalted: true,
        reason: haltReason,
        haltedAt,
      };
      await this.triggerHalt(book, haltReason, haltedAt);
    }

    // 7. Compute cash balance
    const openPos = (backtestResult.openPositions ?? []).map((p) => ({
      ...p,
      symbol,
    }));
    const investedCost = openPos.reduce((sum, p) => sum + p.investedCost, 0);
    const cash = roundTo(latestEquity - investedCost, 2);

    const state: PaperMarketState = {
      book,
      symbol,
      interval,
      initialBalance: this.initialBalance,
      cash,
      equity: roundTo(latestEquity, 2),
      peakEquity: roundTo(peakEquity, 2),
      currentDrawdownPercent,
      maxDrawdownPercent: roundTo(backtestResult.metrics.maxDrawdownPercent, 2),
      isHalted: haltInfo.isHalted,
      haltReason: haltInfo.reason,
      haltedAt: haltInfo.haltedAt,
      forwardStartTimestamp: forwardStartTimestamp > 0 ? forwardStartTimestamp : undefined,
      lastProcessedTimestamp: lastCandle.timestamp,
      openPositions: openPos,
      closedTrades: backtestResult.trades,
      metrics: backtestResult.metrics,
      signalFunnel: backtestResult.signalFunnel,
      updatedAt: lastCandle.timestamp,
    };

    // 8. Persist state
    await this.saveState(state);

    return { state, backtestResult };
  }
}
