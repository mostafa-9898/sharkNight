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
  TrailingStopConfig,
  ExitMode,
  TradeSide,
} from '../backtest/types';
import { roundTo } from '../utils/math';

export type PaperBook = 'A' | 'B';

export interface PaperRunnerOptions {
  dataDir?: string;
  initialBalance?: number;
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
  lastProcessedTimestamp: number;
  openPositions: ActivePosition[];
  closedTrades: Trade[];
  metrics: BacktestMetrics;
  updatedAt: number;
}

export interface BookSpec {
  book: PaperBook;
  name: string;
  strategyConfig: Partial<MultiTimeframeConfig>;
  backtestConfig: {
    positionSizePercent: number;
    maxOpenPositions: number;
    maxTotalExposurePercent: number;
    trailingStop: TrailingStopConfig;
    tradeFeePercent: number;
    slippagePercent: number;
    allowOppositePositions: boolean;
    tradeMode: 'long-only';
    exitMode: 'trailingOnly';
  };
}

export const BOOK_A_SPEC: BookSpec = {
  book: 'A',
  name: 'F3 Long-Only',
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
    allowOppositePositions: true,
  },
};

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

  async isBookHalted(book: PaperBook): Promise<boolean> {
    const haltPath = this.getHaltFilePath(book);
    try {
      await fs.access(haltPath);
      return true;
    } catch {
      return false;
    }
  }

  async triggerHalt(book: PaperBook, reason: string): Promise<void> {
    const haltPath = this.getHaltFilePath(book);
    await fs.mkdir(this.dataDir, { recursive: true });
    const content = JSON.stringify({
      book,
      reason,
      haltedAt: Date.now(),
      iso: new Date().toISOString(),
    }, null, 2);
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
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');
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
  }): Promise<{ state: PaperMarketState; backtestResult: BacktestResult }> {
    const { book, symbol, interval, candles, htf1hCandles, htf4hCandles } = params;
    const closePositionsAtEnd = params.closePositionsAtEnd ?? false;

    if (candles.length === 0) {
      throw new Error('Cannot process empty candle sequence in PaperRunner');
    }

    const spec = book === 'A' ? BOOK_A_SPEC : BOOK_B_SPEC;
    const isHaltedOnDisk = await this.isBookHalted(book);

    let haltTime = params.haltTimestamp;
    if (isHaltedOnDisk && haltTime === undefined) {
      try {
        const haltStat = await fs.stat(this.getHaltFilePath(book));
        haltTime = haltStat.mtimeMs;
      } catch {
        haltTime = 0;
      }
    }

    // 1. Construct the shared strategy
    const rawStrategy = new MultiTimeframeStrategy({
      ...spec.strategyConfig,
      htf1hCandles,
      htf4hCandles,
    });

    // 2. Wrap with HaltableStrategyWrapper if HALT applies
    const strategy = new HaltableStrategyWrapper(rawStrategy, (t: number) => {
      if (isHaltedOnDisk && haltTime !== undefined && t >= haltTime) {
        return true;
      }
      return false;
    });

    // 3. Run shared BacktestEngine
    const backtestConfig: BacktestConfig = {
      strategy,
      candles,
      initialBalance: this.initialBalance,
      closePositionsAtEnd,
      ...spec.backtestConfig,
    };

    const backtestResult = this.engine.run(backtestConfig);

    // 4. Calculate peak equity and drawdown
    let peakEquity = this.initialBalance;
    for (const eq of backtestResult.equity) {
      if (eq > peakEquity) {
        peakEquity = eq;
      }
    }

    const latestEquity = backtestResult.equity[backtestResult.equity.length - 1];
    const currentDrawdownPercent =
      peakEquity > 0 ? roundTo(((peakEquity - latestEquity) / peakEquity) * 100, 2) : 0;

    // 5. Emergency circuit breaker check: DD >= 10.0%
    let isHalted = isHaltedOnDisk;
    let haltReason: string | null = null;
    if (currentDrawdownPercent >= 10.0 && !isHaltedOnDisk) {
      isHalted = true;
      haltReason = `Drawdown reached ${currentDrawdownPercent}% >= 10.0% circuit breaker`;
      await this.triggerHalt(book, haltReason);
    } else if (isHaltedOnDisk) {
      haltReason = 'Halted via HALT flag file';
    }

    // 6. Compute cash balance
    const openPos = backtestResult.openPositions ?? [];
    const investedCost = openPos.reduce((sum, p) => sum + p.investedCost, 0);
    const cash = roundTo(latestEquity - investedCost, 2);

    const lastCandle = candles[candles.length - 1];
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
      isHalted,
      haltReason,
      lastProcessedTimestamp: lastCandle.timestamp,
      openPositions: openPos,
      closedTrades: backtestResult.trades,
      metrics: backtestResult.metrics,
      updatedAt: Date.now(),
    };

    // 7. Persist state
    await this.saveState(state);

    return { state, backtestResult };
  }
}
