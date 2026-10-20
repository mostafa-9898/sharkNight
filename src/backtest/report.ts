import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import type { Candle } from '../data/models/candle';
import type {
  BacktestResult,
  Trade,
  TrailingStopConfig,
} from './types';
import { calculateIchimoku } from '../indicators/ichimoku';
import { calculateRSI } from '../indicators/rsi';
import { roundTo } from '../utils/math';

export interface SaveReportPaths {
  latestMdPath: string;
  latestJsonPath: string;
  historyMdPath: string;
  historyIndexUpdated: boolean;
  diagnosticsMdPath?: string;
}

export interface BacktestReportConfig {
  symbol: string;
  interval: string;
  period?: string;
  dataSource?: string;
  gitCommit?: string;
  isDirty?: boolean;
  startTime?: number;
  endTime?: number;
  asOf?: number;
  isCapped?: boolean;
  coverageStatus?: string;
  coverageWarning?: string;
  datasetFingerprint?: string;
  // Strategy
  strategy?: string;
  strategyName?: string;
  htfMode?: 'strict' | 'legacy';
  entryMode?: 'cross' | 'legacy';
  structureFilter?: boolean;
  tenkan?: number;
  kijun?: number;
  senkouB?: number;
  displacement?: number;
  rsiPeriod?: number;
  rsiBuyMin?: number;
  rsiBuyMax?: number;
  rsiSellMin?: number;
  rsiSellMax?: number;
  rsiLookback?: number;
  cloudFilter?: string;
  rsiRecoveryCap?: number;
  kijunSlopeFilter?: boolean;
  // Engine
  tradeMode?: string;
  exitMode?: string;
  maxBarsInTrade?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  trailingStop?: TrailingStopConfig;
  positionSizePercent?: number;
  riskPerTradePercent?: number;
  tradeFeePercent?: number;
  slippagePercent?: number;
  stopCheckMode?: string;
  initialBalance?: number;
}

export interface BacktestReportInput {
  backtestResult: BacktestResult;
  candles: readonly Candle[];
  indicators?: {
    ichimoku?: {
      tenkan: number[];
      kijun: number[];
      senkouA: number[];
      senkouB: number[];
      chikou: number[];
      params?: {
        tenkan: number;
        kijun: number;
        senkouB: number;
        displacement: number;
      };
    };
    rsi?: number[];
  };
  config: BacktestReportConfig;
}

export interface DrawdownPeriod {
  peakIndex: number;
  peakTime: number;
  peakEquity: number;
  troughIndex: number;
  troughTime: number;
  troughEquity: number;
  recoveryIndex?: number;
  recoveryTime?: number;
  isRecovered: boolean;
  depthPercent: number;
  barsToTrough: number;
  totalBars: number;
  tradesDuring: number[];
}

export interface OppositeTkCrossInTrade {
  candleIndex: number;
  timestamp: number;
  crossDirection: 'up' | 'down';
  unrealizedPnlPercent: number;
}

export interface TradeTrajectory {
  tradeIndex: number;
  entryIndex: number;
  exitIndex: number;
  barsHeld: number;
  unrealizedAtBars: Record<number, number>;
  underwaterBars: number;
  underwaterPercent: number;
  reboundedAfterDrawdown: boolean;
  oppositeTkCrossEvents: OppositeTkCrossInTrade[];
  finalStopPrice?: number;
  ratchetSteps: number;
}

export type InvariantStatus = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'INCOMPLETE';

export interface InvariantResult {
  name: string;
  status: InvariantStatus;
  violations: number;
  details: string;
}

export interface BacktestReportOutput {
  markdown: string;
  json: Record<string, unknown>;
  configHash: string;
  timestampStr: string;
  filename: string;
  diagnosticsMarkdown?: string;
}

function getGitMetadata(): { commit: string; isDirty: boolean } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    return { commit: commit || 'unknown', isDirty: status.length > 0 };
  } catch {
    return { commit: 'unknown', isDirty: false };
  }
}

export function computeDatasetFingerprint(candles: readonly Candle[]): string {
  if (candles.length === 0) return 'empty';
  const hash = crypto.createHash('sha256');
  for (const c of candles) {
    hash.update(`${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume};`);
  }
  return hash.digest('hex').slice(0, 16);
}

export function formatStrategyDisplayName(config: BacktestReportConfig): string {
  const isMtf =
    config.strategy === 'mtf' ||
    config.strategyName === 'MultiTimeframe';

  const kijunStatus = config.kijunSlopeFilter ? 'enabled' : 'disabled';
  const structStatus = config.structureFilter ? 'enabled' : 'disabled';

  if (isMtf) {
    const htf = config.htfMode ?? 'strict';
    const entry = config.entryMode ?? 'cross';
    return `MultiTimeframe (${htf}, ${entry}) (kijunSlopeFilter: ${kijunStatus}, structureFilter: ${structStatus})`;
  } else {
    return `IchimokuRsi (kijunSlopeFilter: ${kijunStatus}, structureFilter: ${structStatus})`;
  }
}

function computeConfigHash(config: BacktestReportConfig): string {
  const normalized: Record<string, unknown> = {};
  const strategyName = formatStrategyDisplayName(config);
  normalized['strategy'] = strategyName;

  const keys = Object.keys(config)
    .filter(
      (k) =>
        k !== 'gitCommit' &&
        k !== 'isDirty' &&
        k !== 'datasetFingerprint' &&
        k !== 'isCapped' &&
        k !== 'coverageStatus' &&
        k !== 'coverageWarning' &&
        (config as unknown as Record<string, unknown>)[k] !== undefined
    )
    .sort();
  for (const k of keys) {
    normalized[k] = (config as unknown as Record<string, unknown>)[k];
  }
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 8);
}

function formatDate(timestamp: number | undefined | null): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'N/A';
  return new Date(timestamp).toISOString().replace('.000Z', 'Z');
}

function formatPercent(val: number | undefined | null, decimals = 2): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '0.00%';
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(decimals)}%`;
}

function formatCurrency(val: number | undefined | null, decimals = 2): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '$0.00';
  const prefix = val < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(val).toFixed(decimals)}`;
}

export function computeDrawdownPeriods(
  equity: readonly number[],
  candles: readonly Candle[],
  trades: readonly Trade[]
): DrawdownPeriod[] {
  if (equity.length === 0) return [];

  const periods: DrawdownPeriod[] = [];
  let peakVal = equity[0];
  let peakIdx = 0;
  let inDrawdown = false;
  let troughVal = equity[0];
  let troughIdx = 0;

  for (let i = 1; i < equity.length; i++) {
    const eq = equity[i];
    if (eq >= peakVal) {
      if (inDrawdown) {
        const depthPercent = ((troughVal - peakVal) / peakVal) * 100;
        if (depthPercent <= -0.1) {
          periods.push({
            peakIndex: peakIdx,
            peakTime: candles[peakIdx]?.timestamp ?? 0,
            peakEquity: peakVal,
            troughIndex: troughIdx,
            troughTime: candles[troughIdx]?.timestamp ?? 0,
            troughEquity: troughVal,
            recoveryIndex: i,
            recoveryTime: candles[i]?.timestamp ?? 0,
            isRecovered: true,
            depthPercent: roundTo(depthPercent, 2),
            barsToTrough: troughIdx - peakIdx,
            totalBars: i - peakIdx,
            tradesDuring: [],
          });
        }
        inDrawdown = false;
      }
      peakVal = eq;
      peakIdx = i;
      troughVal = eq;
      troughIdx = i;
    } else {
      inDrawdown = true;
      if (eq < troughVal) {
        troughVal = eq;
        troughIdx = i;
      }
    }
  }

  if (inDrawdown) {
    const depthPercent = ((troughVal - peakVal) / peakVal) * 100;
    if (depthPercent <= -0.1) {
      periods.push({
        peakIndex: peakIdx,
        peakTime: candles[peakIdx]?.timestamp ?? 0,
        peakEquity: peakVal,
        troughIndex: troughIdx,
        troughTime: candles[troughIdx]?.timestamp ?? 0,
        troughEquity: troughVal,
        isRecovered: false,
        depthPercent: roundTo(depthPercent, 2),
        barsToTrough: troughIdx - peakIdx,
        totalBars: equity.length - 1 - peakIdx,
        tradesDuring: [],
      });
    }
  }

  // Map trades to drawdowns
  for (const p of periods) {
    p.tradesDuring = trades
      .map((t, idx) => ({ t, idx: idx + 1 }))
      .filter(
        ({ t }) =>
          (t.entryTime ?? 0) <= (p.recoveryTime || candles[candles.length - 1]?.timestamp || 0) &&
          (t.exitTime ?? 0) >= p.peakTime
      )
      .map(({ idx }) => idx);
  }

  // Sort by deepest drawdown first
  return periods.sort((a, b) => a.depthPercent - b.depthPercent).slice(0, 5);
}

export function computeTradeTrajectories(
  trades: readonly Trade[],
  candles: readonly Candle[],
  relations: Int8Array
): TradeTrajectory[] {
  const candleMap = new Map<number, number>();
  for (let i = 0; i < candles.length; i++) {
    candleMap.set(candles[i].timestamp, i);
  }

  const targetBars = [1, 3, 6, 12, 24, 48, 96];
  const trajectories: TradeTrajectory[] = [];

  for (let tIdx = 0; tIdx < trades.length; tIdx++) {
    const trade = trades[tIdx];
    const entryIdx = trade.entryTime ? candleMap.get(trade.entryTime) ?? -1 : -1;
    const exitIdx = trade.exitTime ? candleMap.get(trade.exitTime) ?? -1 : -1;

    if (entryIdx === -1 || exitIdx === -1 || exitIdx < entryIdx) {
      trajectories.push({
        tradeIndex: tIdx + 1,
        entryIndex: entryIdx,
        exitIndex: exitIdx,
        barsHeld: trade.duration ?? 0,
        unrealizedAtBars: {},
        underwaterBars: 0,
        underwaterPercent: 0,
        reboundedAfterDrawdown: false,
        oppositeTkCrossEvents: [],
        finalStopPrice: trade.stopPrice,
        ratchetSteps: trade.ratchetSteps ?? 0,
      });
      continue;
    }

    const barsHeld = exitIdx - entryIdx;
    const unrealizedAtBars: Record<number, number> = {};
    let underwaterBars = 0;
    let hadNegative = false;
    let rebounded = false;
    const oppositeTkCrossEvents: OppositeTkCrossInTrade[] = [];

    for (let k = 1; k <= barsHeld; k++) {
      const cIdx = entryIdx + k;
      const c = candles[cIdx];
      if (!c) break;

      const unrealizedPct =
        trade.side === 'long'
          ? ((c.close - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - c.close) / trade.entryPrice) * 100;

      if (targetBars.includes(k)) {
        unrealizedAtBars[k] = roundTo(unrealizedPct, 2);
      }

      if (unrealizedPct < 0) {
        underwaterBars++;
        hadNegative = true;
      } else if (unrealizedPct > 0 && hadNegative) {
        rebounded = true;
      }

      // Check opposite TK cross on this candle (strictly before exit candle)
      if (cIdx > 0 && cIdx < exitIdx) {
        const curRel = relations[cIdx];
        if (curRel !== 0) {
          let lastNonZero = 0;
          for (let j = cIdx - 1; j >= 0; j--) {
            if (relations[j] !== 0) {
              lastNonZero = relations[j];
              break;
            }
          }
          const isCrossUp = curRel === 1 && lastNonZero === -1;
          const isCrossDown = curRel === -1 && lastNonZero === 1;

          if (trade.side === 'long' && isCrossDown) {
            oppositeTkCrossEvents.push({
              candleIndex: cIdx,
              timestamp: c.timestamp,
              crossDirection: 'down',
              unrealizedPnlPercent: roundTo(unrealizedPct, 2),
            });
          } else if (trade.side === 'short' && isCrossUp) {
            oppositeTkCrossEvents.push({
              candleIndex: cIdx,
              timestamp: c.timestamp,
              crossDirection: 'up',
              unrealizedPnlPercent: roundTo(unrealizedPct, 2),
            });
          }
        }
      }
    }

    if (trade.pnlPercent > 0 && hadNegative) {
      rebounded = true;
    }

    const underwaterPercent = barsHeld > 0 ? roundTo((underwaterBars / barsHeld) * 100, 1) : 0;

    trajectories.push({
      tradeIndex: tIdx + 1,
      entryIndex: entryIdx,
      exitIndex: exitIdx,
      barsHeld,
      unrealizedAtBars,
      underwaterBars,
      underwaterPercent,
      reboundedAfterDrawdown: rebounded,
      oppositeTkCrossEvents,
      finalStopPrice: trade.stopPrice,
      ratchetSteps: trade.ratchetSteps ?? 0,
    });
  }

  return trajectories;
}

export function buildBacktestReport(input: BacktestReportInput): BacktestReportOutput {
  const { backtestResult, candles, config } = input;
  const { trades, metrics, equity } = backtestResult;

  const gitInfo =
    config.gitCommit !== undefined
      ? { commit: config.gitCommit, isDirty: Boolean(config.isDirty) }
      : getGitMetadata();

  const configHash = computeConfigHash(config);
  const now = new Date();
  const timestampStr = now.toISOString().replace(/[-:]/g, '').replace('T', '_').replace(/\..+/, '');
  const filename = `${timestampStr}_${config.symbol}_${config.interval}_${configHash}.md`;

  const initialBalance = config.initialBalance ?? 10000;
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const datasetFingerprint = config.datasetFingerprint ?? computeDatasetFingerprint(candles);

  // Indicator series
  const tenkan = config.tenkan ?? 9;
  const kijun = config.kijun ?? 26;
  const senkouB = config.senkouB ?? 52;
  const displacement = config.displacement ?? 26;
  const rsiPeriod = config.rsiPeriod ?? 14;

  const ichimokuData =
    input.indicators?.ichimoku ??
    calculateIchimoku(candles, {
      tenkan,
      kijun,
      senkouB,
      displacement,
    });

  const rsiValues =
    input.indicators?.rsi ?? calculateRSI(candles.map((c) => c.close), rsiPeriod);

  // Sign relations for TK cross checks
  const relations = new Int8Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const t = ichimokuData.tenkan[i];
    const k = ichimokuData.kijun[i];
    if (Number.isFinite(t) && Number.isFinite(k)) {
      relations[i] = t > k ? 1 : t < k ? -1 : 0;
    }
  }

  // Trajectories & drawdowns
  const trajectories = computeTradeTrajectories(trades, candles, relations);
  const drawdowns = computeDrawdownPeriods(equity, candles, trades);

  // Time in market calculation
  let candlesInMarket = 0;
  const inMarketSet = new Set<number>();
  const candleMap = new Map<number, number>();
  for (let i = 0; i < candles.length; i++) {
    candleMap.set(candles[i].timestamp, i);
  }
  for (const t of trades) {
    const en = t.entryTime ? candleMap.get(t.entryTime) ?? -1 : -1;
    const ex = t.exitTime ? candleMap.get(t.exitTime) ?? -1 : -1;
    if (en !== -1 && ex !== -1) {
      for (let j = en; j <= ex; j++) {
        inMarketSet.add(j);
      }
    }
  }
  candlesInMarket = inMarketSet.size;
  const marketExposurePercent =
    candles.length > 0 ? roundTo((candlesInMarket / candles.length) * 100, 2) : 0;

  // Buy & hold return
  const buyAndHoldReturn =
    candles.length >= 2
      ? roundTo(((lastCandle.close - firstCandle.close) / firstCandle.close) * 100, 2)
      : 0;

  // Expectancy & trade counts
  const totalTradesCount = trades.length;
  const winRate = metrics.winRate; // 0-1
  const avgWin = metrics.averageWin;
  const avgLoss = Math.abs(metrics.averageLoss);
  const expectancy = roundTo(winRate * avgWin - (1 - winRate) * avgLoss, 2);

  const hasWins = trades.some((t) => (t.pnl || 0) > 0);
  const hasLosses = trades.some((t) => (t.pnl || 0) < 0);

  // Profit factor & 4 distinct trade situations
  const grossProfit = trades
    .filter((t) => (t.pnl || 0) > 0)
    .reduce((sum, t) => sum + (t.pnl || 0), 0);
  const grossLoss = Math.abs(
    trades.filter((t) => (t.pnl || 0) < 0).reduce((sum, t) => sum + (t.pnl || 0), 0)
  );

  let profitFactorStr: string;
  let profitFactorContext: string;
  let profitFactorVal: number | null;

  if (totalTradesCount === 0) {
    profitFactorStr = 'N/A';
    profitFactorContext = `Gross Profit: $0.00 / Gross Loss: $0.00 (no trades executed)`;
    profitFactorVal = null;
  } else if (grossLoss === 0 && grossProfit > 0) {
    profitFactorStr = 'N/A';
    profitFactorContext = `Gross Profit: ${formatCurrency(grossProfit)} / Gross Loss: $0.00 (zero gross losses; undefined)`;
    profitFactorVal = null;
  } else if (grossLoss > 0 && grossProfit === 0) {
    profitFactorStr = '0.00';
    profitFactorContext = `Gross Profit: $0.00 / Gross Loss: ${formatCurrency(grossLoss)} (zero gross profit)`;
    profitFactorVal = 0;
  } else if (grossLoss === 0 && grossProfit === 0) {
    profitFactorStr = 'N/A';
    profitFactorContext = `Gross Profit: $0.00 / Gross Loss: $0.00 (all trades flat)`;
    profitFactorVal = null;
  } else {
    const pf = roundTo(grossProfit / grossLoss, 2);
    profitFactorStr = pf.toFixed(2);
    profitFactorContext = `Gross Profit: ${formatCurrency(grossProfit)} / Gross Loss: ${formatCurrency(grossLoss)}`;
    profitFactorVal = pf;
  }

  // Average bars
  const totalBarsHeld = trajectories.reduce((sum, tr) => sum + tr.barsHeld, 0);
  const avgBarsHeld = trades.length > 0 ? roundTo(totalBarsHeld / trades.length, 1) : 0;
  const totalTradePnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Best trade & return without best trade & median trade
  let bestTradeItem: Trade | undefined = undefined;
  let bestTradePct = 0;
  let bestTradeDate = 'N/A';
  let returnWithoutBestPercent = 0;
  let pnlWithoutBest = 0;
  let medianTradePct = 0;

  if (trades.length > 0) {
    const sortedTrades = [...trades].sort((a, b) => (b.pnlPercent ?? 0) - (a.pnlPercent ?? 0));
    bestTradeItem = sortedTrades[0];
    bestTradePct = bestTradeItem.pnlPercent ?? 0;
    bestTradeDate = formatDate(bestTradeItem.entryTime);

    pnlWithoutBest = totalTradePnl - (bestTradeItem.pnl || 0);
    returnWithoutBestPercent = roundTo((pnlWithoutBest / initialBalance) * 100, 2);

    const sortedPnlPcts = trades.map((t) => t.pnlPercent ?? 0).sort((a, b) => a - b);
    const midIdx = Math.floor(sortedPnlPcts.length / 2);
    medianTradePct =
      sortedPnlPcts.length % 2 !== 0
        ? sortedPnlPcts[midIdx]
        : roundTo((sortedPnlPcts[midIdx - 1] + sortedPnlPcts[midIdx]) / 2, 2);
  }

  // --- SECTION C: Automated Warning Flags ---
  const flags: Array<{ level: 'CRITICAL' | 'WARNING' | 'NOTICE'; message: string }> = [];

  if (config.coverageWarning) {
    flags.push({
      level: 'WARNING',
      message: `Window Coverage: ${config.coverageWarning}`,
    });
  }

  if (
    bestTradeItem &&
    (bestTradeItem.pnl || 0) > 0 &&
    grossProfit > 0 &&
    (bestTradeItem.pnl || 0) / grossProfit > 0.4
  ) {
    flags.push({
      level: 'WARNING',
      message: 'Profit concentrated in a single trade',
    });
  }

  if (totalTradesCount === 0) {
    flags.push({
      level: 'CRITICAL',
      message:
        'Zero Trades Executed: The backtest executed zero trades. Profitability, expectancy, and risk conclusions cannot be inferred from a zero-trade sample.',
    });
  } else if (expectancy < 0) {
    flags.push({
      level: 'CRITICAL',
      message: `Negative Expectancy (${expectancy}% per trade). The strategy produces an average loss per trade.`,
    });
  }

  const staleRsiTrades = trades.filter((t) => (t.entryDiagnostics?.rsiHitAge ?? 0) > 3);
  const staleRsiPercent =
    trades.length > 0 ? roundTo((staleRsiTrades.length / trades.length) * 100, 1) : 0;
  if (staleRsiPercent > 50) {
    flags.push({
      level: 'WARNING',
      message: `High RSI Lag: ${staleRsiPercent}% of trades (${staleRsiTrades.length}/${trades.length}) entered with stale RSI (triggered > 3 bars prior to TK cross).`,
    });
  }

  const givebackTrades = trades.filter(
    (t) => (t.maxFavorablePercent ?? 0) >= 1.5 && (t.pnlPercent ?? 0) < 0
  );
  if (givebackTrades.length > 0) {
    flags.push({
      level: 'WARNING',
      message: `Profit Giveback: ${givebackTrades.length} trades reached >= +1.5% favorable move but closed at a net loss.`,
    });
  }

  const underwaterTrades = trajectories.filter((tr) => tr.underwaterPercent > 70);
  if (underwaterTrades.length > 0) {
    const pct = roundTo((underwaterTrades.length / (trades.length || 1)) * 100, 1);
    flags.push({
      level: 'WARNING',
      message: `Prolonged Underwater Exposure: ${underwaterTrades.length} trades (${pct}%) spent > 70% of holding time in drawdown.`,
    });
  }

  const oppositeHeldTrades = trajectories.filter((tr) => tr.oppositeTkCrossEvents.length > 0);
  if (oppositeHeldTrades.length > 0) {
    flags.push({
      level: 'WARNING',
      message: `Held Across Opposite TK Cross: ${oppositeHeldTrades.length} trades remained open while an opposite TK cross occurred.`,
    });
  }

  const lastTrade = trades[trades.length - 1];
  const hasForcedEndExit = lastTrade?.exitReason === 'end';
  if (hasForcedEndExit) {
    flags.push({
      level: 'NOTICE',
      message: `Forced Exit at Backtest Conclusion: Final trade #${trades.length} (${lastTrade.side}) was closed forcibly by engine because data ended (PnL: ${formatCurrency(lastTrade.pnl)}, ${formatPercent(lastTrade.pnlPercent)}).`,
    });
  }

  // --- SECTION D: Signal Funnel ---
  const trace = backtestResult.trace;
  const tkCrossEvents = trace?.tkCrossEvents ?? [];
  const ignoredSignals = trace?.ignoredSignals ?? [];

  const tkCrossUpCount = tkCrossEvents.filter((e) => e.direction === 'up').length;
  const tkCrossDownCount = tkCrossEvents.filter((e) => e.direction === 'down').length;
  const crossUpInZone = tkCrossEvents.filter((e) => e.direction === 'up' && e.inRsiZone).length;
  const crossDownInZone = tkCrossEvents.filter((e) => e.direction === 'down' && e.inRsiZone).length;
  const buySignalsEmitted = tkCrossEvents.filter((e) => e.direction === 'up' && e.signalEmitted).length;
  const sellSignalsEmitted = tkCrossEvents.filter((e) => e.direction === 'down' && e.signalEmitted).length;

  const rejectedCrosses = tkCrossEvents.filter((e) => !e.signalEmitted);
  const cloudFilterRejections = rejectedCrosses.filter((e) => e.filterRejection === 'cloudFilter').length;
  const rsiOutOfZoneRejections = rejectedCrosses.filter((e) => e.filterRejection === 'rsiOutOfZone').length;
  const rsiRecoveryCapRejections = rejectedCrosses.filter((e) => e.filterRejection === 'rsiRecoveryCap').length;
  const kijunSlopeFilterRejections = rejectedCrosses.filter((e) => e.filterRejection === 'kijunSlopeFilter').length;

  const ignoredAlreadyInPos = ignoredSignals.filter((e) => e.reason === 'alreadyInPosition').length;
  const ignoredLongOnlyShort = ignoredSignals.filter((e) => e.reason === 'longOnlyShortIgnored').length;
  const ignoredCapPositions = ignoredSignals.filter((e) => e.reason === 'cap_positions').length;
  const ignoredCapExposure = ignoredSignals.filter((e) => e.reason === 'cap_exposure').length;
  const ignoredMinBars = ignoredSignals.filter((e) => e.reason === 'min_bars').length;
  const multiPosDiag = backtestResult.multiPositionDiagnostics;

  // --- SECTION G: Top 10 Worst & Top 10 Best Trades ---
  const tradesWithIdx = trades.map((t, i) => ({ trade: t, index: i + 1 }));
  const sortedWorst = [...tradesWithIdx]
    .sort((a, b) => (a.trade.pnlPercent ?? 0) - (b.trade.pnlPercent ?? 0))
    .slice(0, 10);
  const sortedBest = [...tradesWithIdx]
    .sort((a, b) => (b.trade.pnlPercent ?? 0) - (a.trade.pnlPercent ?? 0))
    .slice(0, 10);

  // --- SECTION H: Open Trade at Conclusion ---
  const completedTrades = hasForcedEndExit ? trades.slice(0, -1) : trades;
  const completedPnl = completedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const completedPnlPercent = roundTo((completedPnl / initialBalance) * 100, 2);

  // --- SECTION J: Breakdowns ---
  // 1. By Side
  const longTrades = trades.filter((t) => t.side === 'long');
  const shortTrades = trades.filter((t) => t.side === 'short');
  const computeSideStats = (list: Trade[]) => {
    const count = list.length;
    const wins = list.filter((t) => (t.pnl || 0) > 0).length;
    const winRateVal = count > 0 ? `${roundTo((wins / count) * 100, 1)}%` : 'N/A';
    const rawTotalPnl = list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
    const totalPnlVal = roundTo(rawTotalPnl, 2);
    const avgPnlVal = count > 0 ? `${formatPercent(roundTo(rawTotalPnl / count, 2))}` : 'N/A';
    const grossW = list.filter((t) => (t.pnl || 0) > 0).reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossL = Math.abs(list.filter((t) => (t.pnl || 0) < 0).reduce((sum, t) => sum + (t.pnl || 0), 0));
    const pfVal =
      count === 0
        ? 'N/A'
        : grossL === 0
          ? grossW > 0
            ? 'N/A'
            : '0.00'
          : roundTo(grossW / grossL, 2).toFixed(2);
    const avgBars =
      count > 0
        ? `${roundTo(
            list.reduce((sum, t) => {
              const idx = trades.indexOf(t);
              return sum + (trajectories[idx]?.barsHeld ?? 0);
            }, 0) / count,
            1
          )} bars`
        : '0 bars';
    return { count, wins, winRate: winRateVal, totalPnl: totalPnlVal, avgPnl: avgPnlVal, pf: pfVal, avgBars };
  };
  const longStats = computeSideStats(longTrades);
  const shortStats = computeSideStats(shortTrades);

  // 2. By Exit Reason
  const exitReasons = [
    'reverse',
    'stopLoss',
    'trailingStop',
    'takeProfit',
    'tkCrossExit',
    'kijunExit',
    'timeStop',
    'end',
  ];
  const exitReasonBreakdown = exitReasons
    .map((reason) => {
      const list = trades.filter((t) => t.exitReason === reason);
      const count = list.length;
      if (count === 0) return null;
      const wins = list.filter((t) => (t.pnl || 0) > 0).length;
      const winRateVal = roundTo((wins / count) * 100, 1);
      const rawTotalPnl = list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
      const totalPnlVal = roundTo(rawTotalPnl, 2);
      const avgPnlVal = roundTo(rawTotalPnl / count, 2);
      const avgBars = roundTo(
        list.reduce((sum, t) => {
          const idx = trades.indexOf(t);
          return sum + (trajectories[idx]?.barsHeld ?? 0);
        }, 0) / count,
        1
      );
      return { reason, count, winRate: winRateVal, totalPnl: totalPnlVal, avgPnl: avgPnlVal, avgBars };
    })
    .filter(Boolean);

  // 3. By Year
  const yearMap = new Map<number, Trade[]>();
  for (const t of trades) {
    if (t.entryTime) {
      const yr = new Date(t.entryTime).getUTCFullYear();
      if (!yearMap.has(yr)) yearMap.set(yr, []);
      yearMap.get(yr)!.push(t);
    }
  }
  const yearBreakdown = Array.from(yearMap.keys())
    .sort()
    .map((yr) => {
      const list = yearMap.get(yr)!;
      const count = list.length;
      const wins = list.filter((t) => (t.pnl || 0) > 0).length;
      const winRateVal = roundTo((wins / count) * 100, 1);
      const rawTotalPnl = list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
      const totalPnlVal = roundTo(rawTotalPnl, 2);
      const avgPnlVal = roundTo(rawTotalPnl / count, 2);
      return { year: yr, count, winRate: winRateVal, totalPnl: totalPnlVal, avgPnl: avgPnlVal };
    });

  // 4. By Price vs Cloud
  const cloudPositions = ['above', 'inside', 'below'] as const;
  const cloudBreakdown = cloudPositions.map((pos) => {
    const list = trades.filter((t) => t.entryDiagnostics?.priceVsCloud === pos);
    const count = list.length;
    const wins = list.filter((t) => (t.pnl || 0) > 0).length;
    const winRateVal = count > 0 ? roundTo((wins / count) * 100, 1) : null;
    const rawTotalPnl = list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
    const totalPnlVal = roundTo(rawTotalPnl, 2);
    const avgPnlVal = count > 0 ? roundTo(rawTotalPnl / count, 2) : null;

    const longList = list.filter((t) => t.side === 'long');
    const longCount = longList.length;
    const longWins = longList.filter((t) => (t.pnl || 0) > 0).length;
    const longWinRate = longCount > 0 ? roundTo((longWins / longCount) * 100, 1) : null;
    const longRawTotal = longList.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
    const longTotalPnl = roundTo(longRawTotal, 2);

    const shortList = list.filter((t) => t.side === 'short');
    const shortCount = shortList.length;
    const shortWins = shortList.filter((t) => (t.pnl || 0) > 0).length;
    const shortWinRate = shortCount > 0 ? roundTo((shortWins / shortCount) * 100, 1) : null;
    const shortRawTotal = shortList.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
    const shortTotalPnl = roundTo(shortRawTotal, 2);

    return {
      position: pos,
      count,
      winRate: winRateVal,
      totalPnl: totalPnlVal,
      avgPnl: avgPnlVal,
      long: { count: longCount, winRate: longWinRate, totalPnl: longTotalPnl },
      short: { count: shortCount, winRate: shortWinRate, totalPnl: shortTotalPnl },
    };
  });

  // 5. By Entry RSI Buckets
  const rsiBuckets = [
    { label: '[20, 30)', min: 20, max: 30 },
    { label: '[30, 40)', min: 30, max: 40 },
    { label: '[40, 50)', min: 40, max: 50 },
    { label: '[50, 60)', min: 50, max: 60 },
    { label: '[60, 70)', min: 60, max: 70 },
    { label: '[70, 80]', min: 70, max: 80.001 },
  ];
  const rsiBreakdown = rsiBuckets.map((b) => {
    const list = trades.filter((t) => {
      const r = t.entryDiagnostics?.rsiAtEntry ?? NaN;
      return Number.isFinite(r) && r >= b.min && r < b.max;
    });
    const count = list.length;
    const wins = list.filter((t) => (t.pnl || 0) > 0).length;
    const winRateVal = count > 0 ? roundTo((wins / count) * 100, 1) : null;
    const rawTotalPnl = list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
    const totalPnlVal = roundTo(rawTotalPnl, 2);
    const avgPnlVal = count > 0 ? roundTo(rawTotalPnl / count, 2) : null;
    return { bucket: b.label, count, winRate: winRateVal, totalPnl: totalPnlVal, avgPnl: avgPnlVal };
  });

  // --- SECTION K: Invariant Self-Checks ---
  const invariantResults: InvariantResult[] = [];

  // Check 1: Cash Conservation Identity
  const finalEquity = equity[equity.length - 1] ?? initialBalance;
  const cashDiscrepancy = Math.abs(initialBalance + totalTradePnl - finalEquity);
  invariantResults.push({
    name: 'Cash / Equity Conservation',
    status: cashDiscrepancy < 1e-5 ? 'PASS' : 'FAIL',
    violations: cashDiscrepancy < 1e-5 ? 0 : 1,
    details: `|initialBalance + sum(trade.pnl) - finalEquity| = ${cashDiscrepancy.toExponential(4)} (threshold 1e-5)`,
  });

  // Check 2: Stop Fill Integrity
  const stopCheckMode = config.stopCheckMode ?? 'intrabar';
  const stopInvariantName =
    stopCheckMode === 'close'
      ? 'Stop Fill Integrity (Close Slippage)'
      : 'Stop Fill Integrity (Intrabar Gap/Slippage)';

  const applicableStopTrades = trades.filter(
    (t) => t.exitReason === 'stopLoss' || t.exitReason === 'trailingStop'
  );
  if (applicableStopTrades.length === 0) {
    invariantResults.push({
      name: stopInvariantName,
      status: 'NOT_APPLICABLE',
      violations: 0,
      details: 'No stop-loss or trailing-stop exits in trade sample (0 applicable trades)',
    });
  } else {
    let checkedCount = 0;
    let uncheckableCount = 0;
    let stopViolations = 0;
    let passedCount = 0;
    const slip = (config.slippagePercent ?? 0) / 100;

    for (const t of applicableStopTrades) {
      const exitIdx = t.exitTime ? candleMap.get(t.exitTime) ?? -1 : -1;
      const c = exitIdx !== -1 ? candles[exitIdx] : null;
      if (!c || t.stopPrice === undefined || !Number.isFinite(t.stopPrice)) {
        uncheckableCount++;
        continue;
      }
      checkedCount++;
      let isViolation = false;
      let expectedBase: number;

      if (stopCheckMode === 'close') {
        expectedBase = c.close;
      } else {
        expectedBase =
          t.side === 'long'
            ? c.open <= t.stopPrice
              ? c.open
              : t.stopPrice
            : c.open >= t.stopPrice
              ? c.open
              : t.stopPrice;
      }

      if (t.side === 'long') {
        const allowedWorst = expectedBase * (1 - slip);
        if (t.exitPrice < allowedWorst - 1e-5) isViolation = true;
      } else {
        const allowedWorst = expectedBase * (1 + slip);
        if (t.exitPrice > allowedWorst + 1e-5) isViolation = true;
      }

      if (isViolation) {
        stopViolations++;
      } else {
        passedCount++;
      }
    }

    const modeDesc =
      stopCheckMode === 'close' ? 'candle close + slippage' : 'allowed stopPrice + gap slippage';
    let stopStatus: InvariantStatus;
    let stopDetails: string;
    if (stopViolations > 0) {
      stopStatus = 'FAIL';
      stopDetails = `Exit price was worse than ${modeDesc} in ${stopViolations}/${checkedCount} checked stop trades${uncheckableCount > 0 ? ` (${uncheckableCount} uncheckable)` : ''}`;
    } else if (uncheckableCount > 0) {
      stopStatus = 'INCOMPLETE';
      stopDetails = `${passedCount}/${checkedCount} checked stop exits verified (${uncheckableCount}/${applicableStopTrades.length} uncheckable due to missing stop price or exit candle)`;
    } else {
      stopStatus = 'PASS';
      stopDetails = `Exit price was at or better than ${modeDesc} in ${passedCount}/${checkedCount} applicable stop trades`;
    }

    invariantResults.push({
      name: stopInvariantName,
      status: stopStatus,
      violations: stopViolations,
      details: stopDetails,
    });
  }

  // Check 3: Trade Non-Overlap
  if (trades.length < 2) {
    invariantResults.push({
      name: 'Trade Non-Overlap (Single Position Invariant)',
      status: 'NOT_APPLICABLE',
      violations: 0,
      details:
        trades.length === 0
          ? 'No trades executed to evaluate trade overlap (0 trade pairs)'
          : 'Only 1 trade executed; no adjacent trade pairs exist to evaluate overlap (0 trade pairs)',
    });
  } else {
    const totalPairs = trades.length - 1;
    let overlapViolations = 0;
    for (let i = 1; i < trades.length; i++) {
      const prevExit = trades[i - 1].exitTime ?? 0;
      const currEntry = trades[i].entryTime ?? 0;
      if (currEntry < prevExit) {
        overlapViolations++;
      }
    }
    const passedPairs = totalPairs - overlapViolations;
    invariantResults.push({
      name: 'Trade Non-Overlap (Single Position Invariant)',
      status: overlapViolations === 0 ? 'PASS' : 'FAIL',
      violations: overlapViolations,
      details:
        overlapViolations === 0
          ? `Every trade entered after or simultaneous with prior trade exit (${passedPairs}/${totalPairs} adjacent pairs verified)`
          : `Trade overlap detected in ${overlapViolations}/${totalPairs} adjacent trade pairs`,
    });
  }

  // Check 4: Trailing Ratchet Step Non-Negativity
  if (!config.trailingStop) {
    invariantResults.push({
      name: 'Trailing Ratchet Step Non-Negativity',
      status: 'NOT_APPLICABLE',
      violations: 0,
      details: 'Trailing stop disabled in configuration (0 applicable trades)',
    });
  } else if (trades.length === 0) {
    invariantResults.push({
      name: 'Trailing Ratchet Step Non-Negativity',
      status: 'NOT_APPLICABLE',
      violations: 0,
      details: 'No trades executed to evaluate trailing ratchet steps (0 applicable trades)',
    });
  } else {
    let ratchetViolations = 0;
    for (const tr of trajectories) {
      if (tr.ratchetSteps < 0) ratchetViolations++;
    }
    invariantResults.push({
      name: 'Trailing Ratchet Step Non-Negativity',
      status: ratchetViolations === 0 ? 'PASS' : 'FAIL',
      violations: ratchetViolations,
      details:
        ratchetViolations === 0
          ? `Trailing ratchet step count non-negative across all trades (${trades.length - ratchetViolations}/${trades.length})`
          : `Negative trailing ratchet step count detected in ${ratchetViolations}/${trades.length} trades`,
    });
  }

  // ==========================================
  // BUILD MARKDOWN (SECTIONS A TO K IN ORDER)
  // ==========================================
  const lines: string[] = [];

  // Title
  lines.push(`# Automated Backtest Review Report`);
  lines.push(`Generated: **${now.toISOString()}** | Config Hash: \`${configHash}\``);
  lines.push(``);

  // Section A: Run Header
  const strategyDisplayName = formatStrategyDisplayName(config);
  const isMtf = config.strategy === 'mtf' || config.strategyName === 'MultiTimeframe';

  lines.push(`## Section A: Run Header`);
  lines.push(`| Property | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Git Commit** | \`${gitInfo.commit}\` (${gitInfo.isDirty ? '⚠️ dirty' : '✅ clean'}) |`);
  lines.push(`| **Strategy** | ${strategyDisplayName} |`);
  lines.push(`| **Symbol / Interval / Period** | \`${config.symbol}\` / \`${config.interval}\` / \`${config.period ?? 'all'}\` |`);
  lines.push(`| **Total Candles** | ${candles.length.toLocaleString()} |`);
  lines.push(`| **Start Time (UTC)** | ${formatDate(firstCandle?.timestamp)} |`);
  lines.push(`| **End Time (UTC)** | ${formatDate(lastCandle?.timestamp)} |`);
  lines.push(`| **Dataset Fingerprint** | \`${datasetFingerprint}\` |`);
  lines.push(
    `| **Data Source** | \`${config.dataSource ?? 'cache'}\` ${config.dataSource === 'synthetic' ? '⚠️ **SYNTHETIC DATA**' : '✅'} |`
  );
  lines.push(`| **Config Hash** | \`${configHash}\` |`);
  lines.push(``);

  lines.push(`### Full Configuration Parameters`);
  lines.push(`| Parameter Group | Parameter | Value |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Ichimoku | Tenkan / Kijun / SenkouB / Displacement | \`${tenkan}\` / \`${kijun}\` / \`${senkouB}\` / \`${displacement}\` |`);
  if (isMtf) {
    lines.push(`| RSI | Period / Lookback | \`disabled\` |`);
    lines.push(`| RSI Zones | Buy Zone / Sell Zone | \`disabled\` |`);
    lines.push(`| Cloud Filter | Mode | \`disabled\` |`);
    lines.push(`| RSI Recovery Cap | Value | \`disabled\` |`);
  } else {
    lines.push(`| RSI | Period / Lookback | \`${rsiPeriod}\` / \`${config.rsiLookback ?? 10}\` |`);
    lines.push(`| RSI Zones | Buy Zone / Sell Zone | \`[${config.rsiBuyMin ?? 20}, ${config.rsiBuyMax ?? 40}]\` / \`[${config.rsiSellMin ?? 60}, ${config.rsiSellMax ?? 80}]\` |`);
    lines.push(`| Cloud Filter | Mode | \`${config.cloudFilter ?? 'off'}\` |`);
    lines.push(`| RSI Recovery Cap | Value | \`${config.rsiRecoveryCap !== undefined ? `+${config.rsiRecoveryCap}` : 'off'}\` |`);
  }
  lines.push(`| Kijun Slope Filter | Status | \`${config.kijunSlopeFilter ? 'enabled' : 'disabled'}\` |`);
  lines.push(`| Structure Filter | Status | \`${config.structureFilter ? 'enabled' : 'disabled'}\` |`);
  lines.push(`| Execution | Trade Mode / Exit Mode | \`${config.tradeMode ?? 'long-short'}\` / \`${config.exitMode ?? 'reverse'}\` |`);
  lines.push(`| Time Stop | maxBarsInTrade | \`${config.maxBarsInTrade ?? 'none'}\` |`);
  lines.push(`| Fixed Stop / TP | Stop Loss % / Take Profit % | \`${config.stopLossPercent ?? 'none'}\` / \`${config.takeProfitPercent ?? 'none'}\` |`);
  if (config.trailingStop) {
    lines.push(
      `| Trailing Stop | Initial / Step / Raise | \`${config.trailingStop.initialStopPercent}%\` / \`${config.trailingStop.stepPercent}%\` / \`${config.trailingStop.raisePercent}%\` |`
    );
  } else {
    lines.push(`| Trailing Stop | Status | \`disabled\` |`);
  }
  lines.push(`| Position Sizing | Position Size % / Risk Per Trade % | \`${config.positionSizePercent ?? 100}%\` / \`${config.riskPerTradePercent ? `${config.riskPerTradePercent}%` : 'off'}\` |`);
  lines.push(`| Fees & Slippage | Fee % / Slippage % / Stop Check Mode | \`${config.tradeFeePercent ?? 0.1}%\` / \`${config.slippagePercent ?? 0}%\` / \`${config.stopCheckMode ?? 'intrabar'}\` |`);
  lines.push(`| Initial Balance | Starting Capital | \`${formatCurrency(initialBalance)}\` |`);
  lines.push(``);

  // Section B: Summary Metrics
  const winRateDisplay = totalTradesCount > 0 ? `${(metrics.winRate * 100).toFixed(1)}%` : 'N/A';
  const longWinRateDisplay = metrics.long.totalTrades > 0 ? `${(metrics.long.winRate * 100).toFixed(1)}%` : 'N/A';
  const shortWinRateDisplay = metrics.short.totalTrades > 0 ? `${(metrics.short.winRate * 100).toFixed(1)}%` : 'N/A';

  const avgWinDisplay = hasWins ? `+${metrics.averageWin.toFixed(2)}%` : 'N/A';
  const avgLossDisplay = hasLosses ? `${metrics.averageLoss.toFixed(2)}%` : 'N/A';
  const winLossRatioDisplay = hasWins && hasLosses && avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : 'N/A';

  const expectancyDisplay =
    totalTradesCount > 0
      ? `${expectancy > 0 ? '+' : ''}${expectancy.toFixed(2)}% per trade`
      : 'N/A';
  const expectancyContext =
    totalTradesCount > 0
      ? 'Mathematical expectancy per executed trade'
      : 'Undefined (zero executed trades)';

  lines.push(`## Section B: Summary Metrics`);
  lines.push(`| Metric | Value | Baseline / Context |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **Net Return** | **${formatPercent(metrics.totalPnlPercent)}** (${formatCurrency(metrics.totalPnl)}) | Initial: ${formatCurrency(initialBalance)} → Final: ${formatCurrency(metrics.finalBalance)} |`);
  lines.push(`| **Best Trade** | ${totalTradesCount > 0 ? `**${formatPercent(bestTradePct)}** (${bestTradeDate})` : '**N/A**'} | Percentage and entry date of best trade |`);
  lines.push(`| **Return without best trade** | ${totalTradesCount > 0 ? `**${formatPercent(returnWithoutBestPercent)}** (${formatCurrency(pnlWithoutBest)})` : '**N/A**'} | Total return excluding best trade |`);
  lines.push(`| **Median trade %** | ${totalTradesCount > 0 ? `**${formatPercent(medianTradePct)}**` : '**N/A**'} | 50th percentile trade return |`);
  lines.push(`| **Buy & Hold Return** | **${formatPercent(buyAndHoldReturn)}** | Market performance over same candle window |`);
  lines.push(`| **Max Drawdown** | **${metrics.maxDrawdownPercent.toFixed(2)}%** | Peak to trough depth on continuous equity |`);
  lines.push(`| **Total Trades** | **${metrics.totalTrades}** | Long: ${metrics.long.totalTrades} / Short: ${metrics.short.totalTrades} |`);
  lines.push(`| **Win Rate** | **${winRateDisplay}** | Long: ${longWinRateDisplay} / Short: ${shortWinRateDisplay} |`);
  lines.push(`| **Average Win / Loss** | **${avgWinDisplay}** / **${avgLossDisplay}** | Win/Loss Ratio: ${winLossRatioDisplay} |`);
  lines.push(`| **Trade Expectancy** | **${expectancyDisplay}** | ${expectancyContext} |`);
  lines.push(`| **Profit Factor** | **${profitFactorStr}** | ${profitFactorContext} |`);
  lines.push(`| **Total Fees Paid** | **${formatCurrency(metrics.totalFees)}** (${metrics.totalFeesPercent.toFixed(2)}% of capital) | Fee Drag: ${metrics.feeDragPercent.toFixed(2)}% |`);
  lines.push(`| **Avg Holding Duration** | **${avgBarsHeld} bars** | Total bars in positions: ${totalBarsHeld.toLocaleString()} |`);
  lines.push(`| **Time in Market** | **${marketExposurePercent}%** | ${candlesInMarket.toLocaleString()} of ${candles.length.toLocaleString()} candles |`);
  lines.push(``);

  // Section C: Automated Warning Flags
  lines.push(`## Section C: Automated Warning Flags`);
  if (flags.length === 0) {
    lines.push(`✅ **No critical warning flags triggered.**`);
  } else {
    for (const f of flags) {
      const icon = f.level === 'CRITICAL' ? '🚨' : f.level === 'WARNING' ? '⚠️' : 'ℹ️';
      lines.push(`- ${icon} **[${f.level}]** ${f.message}`);
    }
  }
  lines.push(``);

  // Section D: Signal Funnel
  lines.push(`## Section D: Signal Funnel`);
  if (!trace) {
    lines.push(
      `> ⚠️ **Notice:** Trace data was not collected for this backtest run (\`collectTrace: false\`). Funnel stage counts and rejection attribution are unavailable.`
    );
    lines.push(``);
  } else {
    lines.push(
      `> ℹ️ **Diagnostic Semantics:** **Crosses with RSI in Zone** reflects independent RSI lookback qualification across all candidate TK crossovers, regardless of upstream filter rejections. In contrast, "Signal Attrition & Rejections" reflects exclusive first-rejection attribution in execution order (Cloud Filter → Kijun Slope Filter → RSI Zone → RSI Recovery Cap). Crosses that qualify for RSI may still be rejected earlier by Cloud or Kijun Slope filters.`
    );
    lines.push(``);
    lines.push(`| Stage | Bullish (BUY) | Bearish (SELL) | Combined |`);
    lines.push(`|---|---|---|---|`);
    lines.push(`| **TK Crossover Events** | ${tkCrossUpCount} | ${tkCrossDownCount} | ${tkCrossUpCount + tkCrossDownCount} |`);
    lines.push(`| **Crosses with RSI in Zone** | ${crossUpInZone} | ${crossDownInZone} | ${crossUpInZone + crossDownInZone} |`);
    lines.push(`| **Signals Emitted** | ${buySignalsEmitted} | ${sellSignalsEmitted} | ${buySignalsEmitted + sellSignalsEmitted} |`);
    lines.push(`| **Signals Executed (Trades)** | ${metrics.long.totalTrades} | ${metrics.short.totalTrades} | ${metrics.totalTrades} |`);
    lines.push(``);

    lines.push(`### Signal Attrition & Rejections`);
    lines.push(`- **Rejected Crosses (Did Not Become Signals):** ${rejectedCrosses.length}`);
    lines.push(`  - RSI out of zone within lookback: **${rsiOutOfZoneRejections}**`);
    lines.push(`  - Rejected by Cloud Filter: **${cloudFilterRejections}**`);
    lines.push(`  - Rejected by RSI Recovery Cap: **${rsiRecoveryCapRejections}**`);
    lines.push(`  - Rejected by Kijun Slope Filter: **${kijunSlopeFilterRejections}**`);
    lines.push(`- **Ignored Signals (Strategy Emitted but Engine Skipped):** ${ignoredSignals.length}`);
    lines.push(`  - Position already open in same direction: **${ignoredAlreadyInPos}**`);
    lines.push(`  - Long-only mode rejected short signal: **${ignoredLongOnlyShort}**`);
    if (ignoredCapPositions > 0) {
      lines.push(`  - Multi-position cap reached (cap_positions): **${ignoredCapPositions}**`);
    }
    if (ignoredCapExposure > 0) {
      lines.push(`  - Maximum exposure cap reached (cap_exposure): **${ignoredCapExposure}**`);
    }
    if (ignoredMinBars > 0) {
      lines.push(`  - Minimum bars between entries not met (min_bars): **${ignoredMinBars}**`);
    }
    if (multiPosDiag && (multiPosDiag.maxConcurrentPositions > 1 || multiPosDiag.percentTimeAtCapacity > 0)) {
      lines.push(``);
      lines.push(`### Multi-Position Concurrency`);
      lines.push(`- **Average Concurrent Positions:** ${multiPosDiag.avgConcurrentPositions}`);
      lines.push(`- **Max Concurrent Positions:** ${multiPosDiag.maxConcurrentPositions}`);
      lines.push(`- **Time at Capacity (% of bars):** ${multiPosDiag.percentTimeAtCapacity}%`);
      lines.push(`- **Signals Rejected Breakdown:** cap_positions=${multiPosDiag.rejectedSignals.cap_positions}, cap_exposure=${multiPosDiag.rejectedSignals.cap_exposure}, min_bars=${multiPosDiag.rejectedSignals.min_bars}`);
    }
    lines.push(``);

    if (rejectedCrosses.length > 0) {
      lines.push(`#### Sample of Rejected TK Crosses (First 8 Events)`);
      lines.push(`| Time (UTC) | Direction | Price | RSI at Cross | Reason Rejected |`);
      lines.push(`|---|---|---|---|---|`);
      for (const r of rejectedCrosses.slice(0, 8)) {
        lines.push(
          `| ${formatDate(r.timestamp)} | \`${r.direction.toUpperCase()}\` | $${r.price.toFixed(2)} | ${r.rsi.toFixed(1)} | \`${r.filterRejection ?? 'rsiOutOfZone'}\` |`
        );
      }
      lines.push(``);
    }
  }

  // Section E: Compact Trades Table
  lines.push(`## Section E: Compact Trades Table`);
  const maxTradesInMd = 100;
  const isTruncated = trades.length > maxTradesInMd;

  if (isTruncated) {
    lines.push(
      `> ℹ️ **Display Note:** Displaying 80 representative trades (first 30, last 30, and top 20 outliers) out of **${trades.length}** total trades to keep report under 400KB limit. The full list of all ${trades.length} trades is preserved in \`backtest-latest.json\`.`
    );
    lines.push(``);
  }

  lines.push(`| # | Side | Entry Time | Entry Price | Exit Time | Exit Price | Bars | PnL % | Exit Reason | MFE % | MAE % | Giveback % | RSI Age |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);

  const renderTradeRow = (t: Trade, idx: number) => {
    const mfe = t.maxFavorablePercent ?? 0;
    const pnl = t.pnlPercent ?? 0;
    const giveback = roundTo(Math.max(0, mfe - Math.max(0, pnl)), 2);
    const rsiAge = t.entryDiagnostics?.rsiHitAge ?? '-';
    const barsHeld = trajectories[idx - 1]?.barsHeld ?? (t.duration ?? 0);
    return `| ${idx} | \`${t.side}\` | ${formatDate(t.entryTime)} | $${t.entryPrice.toFixed(2)} | ${formatDate(t.exitTime)} | $${t.exitPrice.toFixed(2)} | ${barsHeld} | **${formatPercent(t.pnlPercent)}** | \`${t.exitReason}\` | +${mfe.toFixed(2)}% | -${(t.maxAdversePercent ?? 0).toFixed(2)}% | ${giveback.toFixed(2)}% | ${rsiAge} |`;
  };

  if (!isTruncated) {
    trades.forEach((t, i) => lines.push(renderTradeRow(t, i + 1)));
  } else {
    // First 30
    for (let i = 0; i < 30; i++) {
      lines.push(renderTradeRow(trades[i], i + 1));
    }
    lines.push(`| ... | ... | *(middle trades omitted for brevity; see backtest-latest.json)* | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |`);
    // Last 30
    for (let i = trades.length - 30; i < trades.length; i++) {
      lines.push(renderTradeRow(trades[i], i + 1));
    }
  }
  lines.push(``);

  // Section F: Per-Trade Trajectory Analysis
  lines.push(`## Section F: Per-Trade Trajectory Analysis`);
  const reboundedCount = trajectories.filter((tr) => tr.reboundedAfterDrawdown).length;
  const permanentlyUnderwater = trajectories.filter((tr) => tr.underwaterPercent >= 99).length;
  const reboundedPctStr = trades.length > 0 ? `${roundTo((reboundedCount / trades.length) * 100, 1)}%` : 'N/A';
  const underwaterPctStr = trades.length > 0 ? `${roundTo((permanentlyUnderwater / trades.length) * 100, 1)}%` : 'N/A';
  lines.push(`- **Trades Rebounding After Drawdown:** ${reboundedCount} (${reboundedPctStr})`);
  lines.push(`- **Permanently Underwater Trades:** ${permanentlyUnderwater} (${underwaterPctStr})`);
  lines.push(``);

  lines.push(`### Average Unrealized PnL Progression (Winners vs Losers)`);
  lines.push(`| Candle Horizon | All Trades | Winning Trades | Losing Trades |`);
  lines.push(`|---|---|---|---|`);
  const intervals = [1, 3, 6, 12, 24, 48, 96];
  for (const bar of intervals) {
    const allVals = trajectories
      .map((tr) => tr.unrealizedAtBars[bar])
      .filter((v): v is number => v !== undefined);
    const winVals = trajectories
      .filter((tr) => (trades[tr.tradeIndex - 1]?.pnlPercent ?? 0) > 0)
      .map((tr) => tr.unrealizedAtBars[bar])
      .filter((v): v is number => v !== undefined);
    const lossVals = trajectories
      .filter((tr) => (trades[tr.tradeIndex - 1]?.pnlPercent ?? 0) < 0)
      .map((tr) => tr.unrealizedAtBars[bar])
      .filter((v): v is number => v !== undefined);

    const avgAllStr =
      allVals.length > 0
        ? `${formatPercent(roundTo(allVals.reduce((s, v) => s + v, 0) / allVals.length, 2))} (${allVals.length} trades)`
        : 'N/A (0 trades)';
    const avgWinStr =
      winVals.length > 0
        ? formatPercent(roundTo(winVals.reduce((s, v) => s + v, 0) / winVals.length, 2))
        : 'N/A';
    const avgLossStr =
      lossVals.length > 0
        ? formatPercent(roundTo(lossVals.reduce((s, v) => s + v, 0) / lossVals.length, 2))
        : 'N/A';

    lines.push(`| **Bar ${bar}** | ${avgAllStr} | ${avgWinStr} | ${avgLossStr} |`);
  }
  lines.push(``);

  // Section G: Top 10 Worst & Top 10 Best Trades (with Candle Context)
  lines.push(`## Section G: Outlier Trades Analysis (Top 10 Worst & Best)`);

  const renderOutlierTrade = (item: { trade: Trade; index: number }, rank: number, type: 'WORST' | 'BEST') => {
    const t = item.trade;
    const idx = item.index;
    const diag = t.entryDiagnostics;
    const entryIdx = t.entryTime ? candleMap.get(t.entryTime) ?? -1 : -1;
    const exitIdx = t.exitTime ? candleMap.get(t.exitTime) ?? -1 : -1;

    lines.push(`### ${type} #${rank}: Trade #${idx} (${t.side.toUpperCase()}) — Return: ${formatPercent(t.pnlPercent)} (${formatCurrency(t.pnl)})`);
    lines.push(`- **Entry:** ${formatDate(t.entryTime)} @ $${t.entryPrice.toFixed(2)} | **Exit:** ${formatDate(t.exitTime)} @ $${t.exitPrice.toFixed(2)} (\`${t.exitReason}\`)`);
    const barsHeld = trajectories[idx - 1]?.barsHeld ?? (t.duration ?? 0);
    lines.push(`- **Holding:** ${barsHeld} bars | **MFE:** +${(t.maxFavorablePercent ?? 0).toFixed(2)}% | **MAE:** -${(t.maxAdversePercent ?? 0).toFixed(2)}%`);

    if (diag) {
      lines.push(`- **Entry Diagnostics:**`);
      lines.push(`  - Price vs Cloud: \`${diag.priceVsCloud}\` | TK Cross vs Cloud: \`${diag.tkCrossVsCloud}\` | Cloud Thickness: \`${diag.cloudThicknessPercent}%\``);
      lines.push(`  - RSI at Entry: \`${diag.rsiAtEntry}\` | RSI Hit Value: \`${diag.rsiHitValue}\` | RSI Hit Age: \`${diag.rsiHitAge} bars\``);
      lines.push(`  - Kijun Slope: \`${diag.kijunSlope}%\` | ATR Percentile: \`${diag.atrPercentile}%\` | Distance from Kijun: \`${diag.distanceFromKijunAtr} ATR\``);
      lines.push(`  - Timing: UTC hour \`${diag.hourOfDayUtc}:00\` | Day of Week: \`${diag.dayOfWeek}\``);
    }

    if (entryIdx !== -1 && exitIdx !== -1) {
      const startEntry = Math.max(0, entryIdx - 2);
      const endEntry = Math.min(candles.length - 1, entryIdx + 2);
      const startExit = Math.max(0, exitIdx - 2);
      const endExit = Math.min(candles.length - 1, exitIdx + 1);

      const indicesSet = new Set<number>();
      for (let k = startEntry; k <= endEntry; k++) indicesSet.add(k);
      for (let k = startExit; k <= endExit; k++) indicesSet.add(k);
      const sortedCandleIndices = Array.from(indicesSet).sort((a, b) => a - b);

      lines.push(``);
      lines.push(`| Time (UTC) | Open | High | Low | Close | RSI | Tenkan | Kijun | Cloud Top | Cloud Btm | Note |`);
      lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);

      for (const ci of sortedCandleIndices) {
        const c = candles[ci];
        const r = rsiValues[ci];
        const tn = ichimokuData.tenkan[ci];
        const kj = ichimokuData.kijun[ci];
        const spA = ichimokuData.senkouA[ci];
        const spB = ichimokuData.senkouB[ci];
        const hasCl = Number.isFinite(spA) && Number.isFinite(spB);
        const clTop = hasCl ? Math.max(spA, spB) : NaN;
        const clBtm = hasCl ? Math.min(spA, spB) : NaN;

        let note = '-';
        if (ci === entryIdx) {
          note = `**[ENTRY] ${t.side.toUpperCase()}**`;
        } else if (ci === exitIdx) {
          note = `**[EXIT] ${t.exitReason}**`;
        }

        lines.push(
          `| ${formatDate(c.timestamp)} | $${c.open.toFixed(1)} | $${c.high.toFixed(1)} | $${c.low.toFixed(1)} | $${c.close.toFixed(1)} | ${Number.isFinite(r) ? r.toFixed(1) : '-'} | ${Number.isFinite(tn) ? tn.toFixed(1) : '-'} | ${Number.isFinite(kj) ? kj.toFixed(1) : '-'} | ${Number.isFinite(clTop) ? clTop.toFixed(1) : '-'} | ${Number.isFinite(clBtm) ? clBtm.toFixed(1) : '-'} | ${note} |`
        );
      }
    }
    lines.push(``);
  };

  lines.push(`### Top 10 Worst Trades (Largest Losses)`);
  sortedWorst.forEach((item, r) => renderOutlierTrade(item, r + 1, 'WORST'));

  lines.push(`### Top 10 Best Trades (Largest Gains)`);
  sortedBest.forEach((item, r) => renderOutlierTrade(item, r + 1, 'BEST'));

  // Section H: Open Trade at Conclusion
  lines.push(`## Section H: Open Trade at Backtest Conclusion`);
  if (totalTradesCount === 0) {
    lines.push(`ℹ️ **No trades executed.** No trades were executed, no positions were opened, and no forced liquidation was required.`);
  } else if (hasForcedEndExit && lastTrade) {
    lines.push(`⚠️ **Ongoing / Forced Exit Active at End of Data**`);
    lines.push(`- The backtest finished with an open position that was forcibly liquidated on the final candle close.`);
    lines.push(`- **Forced Trade:** #${trades.length} (${lastTrade.side.toUpperCase()}) | Entered @ $${lastTrade.entryPrice.toFixed(2)} | Liquidated @ $${lastTrade.exitPrice.toFixed(2)}`);
    lines.push(`- **Forced Trade PnL:** ${formatCurrency(lastTrade.pnl)} (${formatPercent(lastTrade.pnlPercent)})`);
    lines.push(`- **Return Performance Segregation:**`);
    lines.push(`  - Return with Forced Exit: **${formatPercent(metrics.totalPnlPercent)}** (${formatCurrency(metrics.totalPnl)})`);
    lines.push(`  - Return without Forced Exit (Natural Exits Only): **${formatPercent(completedPnlPercent)}** (${formatCurrency(completedPnl)})`);
  } else {
    lines.push(`✅ **No forced exit at backtest conclusion.** Portfolio finished in 100% cash with all positions exited through regular strategy signals or stops.`);
  }
  lines.push(``);

  // Section I: Drawdown Periods
  lines.push(`## Section I: Top 5 Drawdown Periods`);
  if (drawdowns.length === 0) {
    lines.push(`_No significant drawdown periods detected on the equity curve._`);
  } else {
    lines.push(`| Rank | Peak Date | Peak Equity | Trough Date | Trough Equity | Depth % | Bars to Trough | Recovery Date | Active Trades |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    drawdowns.forEach((dd, idx) => {
      const rec = dd.isRecovered ? formatDate(dd.recoveryTime) : '⚠️ Ongoing';
      lines.push(
        `| ${idx + 1} | ${formatDate(dd.peakTime)} | ${formatCurrency(dd.peakEquity)} | ${formatDate(dd.troughTime)} | ${formatCurrency(dd.troughEquity)} | **${dd.depthPercent.toFixed(2)}%** | ${dd.barsToTrough} bars | ${rec} | ${dd.tradesDuring.length} trades |`
      );
    });
  }
  lines.push(``);

  // Section J: Performance Breakdowns
  lines.push(`## Section J: Performance Breakdowns`);

  lines.push(`### 1. By Side (Long vs Short)`);
  lines.push(`| Side | Trades | Win Rate | Total Return % | Avg Return % | Profit Factor | Avg Duration |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  lines.push(`| **Long** | ${longStats.count} | ${longStats.winRate} | ${formatPercent(longStats.totalPnl)} | ${longStats.avgPnl} | ${longStats.pf} | ${longStats.avgBars} |`);
  lines.push(`| **Short** | ${shortStats.count} | ${shortStats.winRate} | ${formatPercent(shortStats.totalPnl)} | ${shortStats.avgPnl} | ${shortStats.pf} | ${shortStats.avgBars} |`);
  lines.push(``);

  lines.push(`### 2. By Exit Reason`);
  lines.push(`| Exit Reason | Trades | Win Rate | Total Return % | Avg Return % | Avg Duration |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const b of exitReasonBreakdown) {
    if (!b) continue;
    lines.push(`| \`${b.reason}\` | ${b.count} | ${b.winRate}% | ${formatPercent(b.totalPnl)} | ${formatPercent(b.avgPnl)} | ${b.avgBars} bars |`);
  }
  lines.push(``);

  lines.push(`### 3. By Year`);
  lines.push(`| Year | Trades | Win Rate | Total Return % | Avg Return % |`);
  lines.push(`|---|---|---|---|---|`);
  for (const y of yearBreakdown) {
    lines.push(`| **${y.year}** | ${y.count} | ${y.winRate}% | ${formatPercent(y.totalPnl)} | ${formatPercent(y.avgPnl)} |`);
  }
  lines.push(``);

  lines.push(`### 4. By Price vs Cloud at Entry`);
  lines.push(`| Price Location | Trades | Win Rate | Total Return % | Avg Return % | Long (Trades / WinRate / Ret%) | Short (Trades / WinRate / Ret%) |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const c of cloudBreakdown) {
    const winRateStr = c.winRate !== null ? `${c.winRate}%` : 'N/A';
    const avgPnlStr = c.avgPnl !== null ? formatPercent(c.avgPnl) : 'N/A';
    const longWrStr = c.long.winRate !== null ? `${c.long.winRate}%` : 'N/A';
    const shortWrStr = c.short.winRate !== null ? `${c.short.winRate}%` : 'N/A';
    const longStr = `${c.long.count} / ${longWrStr} / ${formatPercent(c.long.totalPnl)}`;
    const shortStr = `${c.short.count} / ${shortWrStr} / ${formatPercent(c.short.totalPnl)}`;
    lines.push(`| \`${c.position}\` | ${c.count} | ${winRateStr} | ${formatPercent(c.totalPnl)} | ${avgPnlStr} | ${longStr} | ${shortStr} |`);
  }
  lines.push(``);

  lines.push(`### 5. By Entry RSI Buckets`);
  lines.push(`| RSI Bucket | Trades | Win Rate | Total Return % | Avg Return % |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of rsiBreakdown) {
    const winRateStr = r.winRate !== null ? `${r.winRate}%` : 'N/A';
    const avgPnlStr = r.avgPnl !== null ? formatPercent(r.avgPnl) : 'N/A';
    lines.push(`| \`${r.bucket}\` | ${r.count} | ${winRateStr} | ${formatPercent(r.totalPnl)} | ${avgPnlStr} |`);
  }
  lines.push(``);

  // Section K: Invariant Self-Checks
  lines.push(`## Section K: Invariant Self-Checks`);
  lines.push(`| Invariant Name | Status | Violations | Verification Details |`);
  lines.push(`|---|---|---|---|`);
  for (const inv of invariantResults) {
    let icon: string;
    if (inv.status === 'PASS') icon = '✅ PASS';
    else if (inv.status === 'FAIL') icon = '❌ FAIL';
    else if (inv.status === 'INCOMPLETE') icon = '⚠️ INCOMPLETE';
    else icon = '⚪ N/A';
    lines.push(`| **${inv.name}** | ${icon} | ${inv.violations} | ${inv.details} |`);
  }
  lines.push(``);

  const markdown = lines.join('\n');

  // JSON payload
  const jsonReport: Record<string, unknown> = {
    meta: {
      generatedAt: now.toISOString(),
      configHash,
      gitCommit: gitInfo.commit,
      isDirty: gitInfo.isDirty,
      symbol: config.symbol,
      interval: config.interval,
      period: config.period ?? 'all',
      dataSource: config.dataSource ?? 'cache',
      candleCount: candles.length,
      startTime: firstCandle?.timestamp,
      endTime: lastCandle?.timestamp,
      effectiveStartTime: firstCandle?.timestamp,
      effectiveEndTime: lastCandle?.timestamp,
      datasetFingerprint,
      config,
    },
    summary: {
      initialBalance,
      finalBalance: metrics.finalBalance,
      netReturnPercent: metrics.totalPnlPercent,
      netReturnDollar: metrics.totalPnl,
      bestTradePercent: totalTradesCount > 0 ? bestTradePct : null,
      bestTradeDate: totalTradesCount > 0 ? bestTradeDate : null,
      returnWithoutBestTradePercent: totalTradesCount > 0 ? returnWithoutBestPercent : null,
      medianTradePercent: totalTradesCount > 0 ? medianTradePct : null,
      buyAndHoldReturnPercent: buyAndHoldReturn,
      maxDrawdownPercent: metrics.maxDrawdownPercent,
      totalTrades: metrics.totalTrades,
      winRate: totalTradesCount > 0 ? metrics.winRate : null,
      winRateDisplay,
      averageWinPercent: hasWins ? metrics.averageWin : null,
      averageLossPercent: hasLosses ? metrics.averageLoss : null,
      expectancyPercent: totalTradesCount > 0 ? expectancy : null,
      profitFactor: profitFactorVal,
      profitFactorDisplay: profitFactorStr,
      totalFees: metrics.totalFees,
      totalFeesPercent: metrics.totalFeesPercent,
      feeDragPercent: metrics.feeDragPercent,
      avgBarsHeld,
      marketExposurePercent,
      long: {
        ...metrics.long,
        winRate: metrics.long.totalTrades > 0 ? metrics.long.winRate : null,
      },
      short: {
        ...metrics.short,
        winRate: metrics.short.totalTrades > 0 ? metrics.short.winRate : null,
      },
    },
    flags,
    funnel: trace
      ? {
          tkCrossUpCount,
          tkCrossDownCount,
          crossUpInZone,
          crossDownInZone,
          buySignalsEmitted,
          sellSignalsEmitted,
          executedTradesTotal: trades.length,
          rejections: {
            total: rejectedCrosses.length,
            rsiOutOfZone: rsiOutOfZoneRejections,
            cloudFilter: cloudFilterRejections,
            rsiRecoveryCap: rsiRecoveryCapRejections,
            kijunSlopeFilter: kijunSlopeFilterRejections,
          },
          ignoredSignals: {
            total: ignoredSignals.length,
            alreadyInPosition: ignoredAlreadyInPos,
            longOnlyShortIgnored: ignoredLongOnlyShort,
            cap_positions: ignoredCapPositions,
            cap_exposure: ignoredCapExposure,
            min_bars: ignoredMinBars,
          },
          multiPositionDiagnostics: multiPosDiag ?? null,
        }
      : null,
    trades: trades.map((t, i) => ({
      index: i + 1,
      ...t,
      trajectory: trajectories[i],
    })),
    drawdowns,
    breakdowns: {
      side: { long: longStats, short: shortStats },
      exitReason: exitReasonBreakdown,
      year: yearBreakdown,
      priceVsCloud: cloudBreakdown,
      rsiBuckets: rsiBreakdown,
    },
    invariants: invariantResults,
  };

  const diagnosticsMarkdown = buildTradeDiagnosticsReport({
    input,
    trajectories,
    drawdowns,
    datasetFingerprint,
    configHash,
    flags,
    invariantResults,
    gitCommit: gitInfo.commit,
    isDirty: gitInfo.isDirty,
  });

  return {
    markdown,
    json: jsonReport,
    configHash,
    timestampStr,
    filename,
    diagnosticsMarkdown,
  };
}

export interface TradeDiagnosticsInput {
  input: BacktestReportInput;
  trajectories: TradeTrajectory[];
  drawdowns: DrawdownPeriod[];
  datasetFingerprint: string;
  configHash: string;
  flags: Array<{ level: string; message: string }>;
  invariantResults: InvariantResult[];
  gitCommit: string;
  isDirty: boolean;
}

export function buildTradeDiagnosticsReport(params: TradeDiagnosticsInput): string {
  const {
    input,
    trajectories,
    drawdowns,
    datasetFingerprint,
    configHash,
    flags,
    invariantResults,
    gitCommit,
    isDirty,
  } = params;

  const { backtestResult, candles, config } = input;
  const { trades, metrics } = backtestResult;
  const initialBalance = config.initialBalance ?? 10000;
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];

  const initialStopPercent =
    config.trailingStop !== undefined
      ? config.trailingStop.initialStopPercent
      : (config.stopLossPercent ?? 5);

  const evalType =
    config.period === 'all' || config.period === '6y'
      ? 'In-Sample Baseline (6y Historical Window)'
      : config.period === '1y'
      ? 'Out-of-Sample / 1-Year Holdout Window'
      : `${config.period ?? 'Standard'} Evaluation Window`;

  const completedTrades = trades.filter((t) => t.exitReason !== 'end');
  const openTrade = trades.find((t) => t.exitReason === 'end');

  // Trade duration in bar counts
  const tradeDurationBars = new Map<Trade, number>();
  for (let i = 0; i < trades.length; i++) {
    const tr = trajectories[i];
    const bars = tr ? tr.barsHeld : 0;
    tradeDurationBars.set(trades[i], bars);
  }

  // Loss streaks
  let maxConsecutiveLosses = 0;
  let currentLosses = 0;
  let maxLossDurationBars = 0;
  let currentLossDurationBars = 0;
  let maxLossDurationMs = 0;
  let currentLossDurationMs = 0;

  for (const t of completedTrades) {
    const bars = tradeDurationBars.get(t) ?? 0;
    if ((t.pnl || 0) < 0) {
      currentLosses++;
      currentLossDurationBars += bars;
      const ms = (t.exitTime ?? 0) - (t.entryTime ?? 0);
      currentLossDurationMs += ms > 0 ? ms : 0;
      if (currentLosses > maxConsecutiveLosses) {
        maxConsecutiveLosses = currentLosses;
        maxLossDurationBars = currentLossDurationBars;
        maxLossDurationMs = currentLossDurationMs;
      }
    } else {
      currentLosses = 0;
      currentLossDurationBars = 0;
      currentLossDurationMs = 0;
    }
  }
  const maxLossDurationDays = (maxLossDurationMs / (1000 * 60 * 60 * 24)).toFixed(1);

  // Durations (in bars)
  const durations = completedTrades.map((t) => tradeDurationBars.get(t) ?? 0).sort((a, b) => a - b);
  const avgDuration =
    durations.length > 0 ? roundTo(durations.reduce((a, b) => a + b, 0) / durations.length, 1) : 0;
  const medianDuration = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;
  const maxDuration = durations.length > 0 ? durations[durations.length - 1] : 0;

  // Exposure
  const totalBarsHeld = completedTrades.reduce((acc, t) => acc + (tradeDurationBars.get(t) ?? 0), 0);
  const exposurePct = candles.length > 0 ? roundTo((totalBarsHeld / candles.length) * 100, 2) : 0;

  // Trailing stats
  const trailingTriggeredTrades = completedTrades.filter((t) => (t.ratchetSteps ?? 0) > 0);
  const trailingTriggeredPct =
    completedTrades.length > 0
      ? roundTo((trailingTriggeredTrades.length / completedTrades.length) * 100, 1)
      : 0;

  // Total giveback
  const totalGivebackDollar = completedTrades.reduce((acc, t) => {
    const mfe = t.maxFavorablePercent ?? 0;
    const pnlPct = t.pnlPercent ?? 0;
    const gbPct = Math.max(0, mfe - Math.max(0, pnlPct));
    return acc + (gbPct / 100) * (t.quantity * t.entryPrice);
  }, 0);

  const lines: string[] = [];

  // Header
  lines.push(`# Trade Diagnostics Report — Latest Backtest Run`);
  lines.push(``);
  lines.push(
    `> **Canonical Diagnostic Log** | Generated: \`${new Date().toISOString()}\` | Git: \`${gitCommit}\` (${isDirty ? 'dirty' : 'clean'}) | Config Hash: \`${configHash}\``
  );
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // Section 1: Run Identity & Reproducibility
  lines.push(`## Section 1: Run Identity & Reproducibility`);
  lines.push(`| Parameter | Value | Specification Details |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **Run Timestamp (UTC)** | \`${new Date().toISOString()}\` | Deterministic backtest execution |`);
  lines.push(`| **Git Revision** | \`${gitCommit}\` | Working tree: \`${isDirty ? 'DIRTY' : 'CLEAN'}\` |`);
  lines.push(`| **Strategy** | **${formatStrategyDisplayName(config)}** | Strategy engine configuration |`);
  lines.push(`| **Symbol & Timeframe** | \`${config.symbol}\` / \`${config.interval}\` | Higher-timeframe context |`);
  lines.push(`| **Evaluation Type** | **${evalType}** | Out-of-sample / In-sample protocol |`);
  lines.push(
    `| **Effective Data Window** | \`${formatDate(firstCandle?.timestamp)}\` → \`${formatDate(lastCandle?.timestamp)}\` | Period: \`${config.period ?? 'all'}\` |`
  );
  lines.push(
    `| **Candle Dataset** | **${candles.length.toLocaleString()}** candles | Fingerprint: \`${datasetFingerprint}\` |`
  );
  lines.push(
    `| **Strategy Indicators** | Ichimoku (${config.tenkan ?? 9}, ${config.kijun ?? 26}, ${config.senkouB ?? 52}, ${config.displacement ?? 26}) | RSI (${config.rsiPeriod ?? 14}, Zones: [${config.rsiBuyMin ?? 20}, ${config.rsiBuyMax ?? 40}] / [${config.rsiSellMin ?? 60}, ${config.rsiSellMax ?? 80}], Lookback: ${config.rsiLookback ?? 20}) |`
  );
  lines.push(
    `| **Filters Applied** | Cloud: \`${config.cloudFilter ?? 'off'}\` | Kijun Slope: \`${config.kijunSlopeFilter ? 'ON' : 'OFF'}\`, RSI Cap: \`${config.rsiRecoveryCap ?? 'N/A'}\` |`
  );
  lines.push(
    `| **Execution & Trade Mode** | \`${config.tradeMode ?? 'long-short'}\` / \`${config.exitMode ?? 'reverse'}\` | Intrabar stop checking: \`${config.stopCheckMode ?? 'intrabar'}\` |`
  );
  lines.push(
    `| **Position Sizing & Risk** | Size: **${config.positionSizePercent ?? 20}%** | Risk per trade: **${config.riskPerTradePercent ?? 1}%** (Initial Capital: $${initialBalance.toLocaleString()}) |`
  );
  lines.push(
    `| **Cost Model** | Fee: **${config.tradeFeePercent ?? 0.1}%** per side | Adverse exit slippage: **${config.slippagePercent ?? 0}%** |`
  );
  lines.push(
    `| **Stop Loss Policy** | **${initialStopPercent.toFixed(1)}%** initial stop | Type: ${config.trailingStop ? 'Stepped Trailing' : 'Fixed Stop Loss'} |`
  );
  lines.push(
    `| **Trailing Stop Policy** | ${config.trailingStop ? `Step: **${config.trailingStop.stepPercent}%**, Raise: **${config.trailingStop.raisePercent}%**` : '`DISABLED` (N/A)'} | ${config.trailingStop ? 'Activates on favorable price movement' : 'Requires --trailingStop to enable'} |`
  );
  lines.push(
    `| **Take Profit Target** | ${config.takeProfitPercent ? `${config.takeProfitPercent}%` : '`DISABLED` (N/A)'} | Uncapped trend-following mode |`
  );
  lines.push(``);

  // Section 2: Executive Summary & Capital Preservation Diagnostics
  lines.push(`## Section 2: Executive Summary & Capital Preservation Diagnostics`);
  const netDollar = metrics.totalPnl;
  const netPct = metrics.totalPnlPercent;
  const maxDd = metrics.maxDrawdownPercent;
  const winRateStr = metrics.totalTrades > 0 ? `${(metrics.winRate * 100).toFixed(1)}%` : 'N/A';
  const pfStr =
    metrics.losingTrades === 0
      ? metrics.winningTrades > 0
        ? '∞'
        : 'N/A'
      : (
          Math.abs(metrics.averageWin * metrics.winningTrades) /
          Math.abs(metrics.averageLoss * metrics.losingTrades || 1)
        ).toFixed(2);
  const expectancy =
    metrics.totalTrades > 0 ? roundTo(metrics.totalPnlPercent / metrics.totalTrades, 2) : 0;
  const winLossRatio =
    metrics.averageLoss !== 0
      ? Math.abs(metrics.averageWin / metrics.averageLoss).toFixed(2)
      : 'N/A';

  lines.push(`| Performance Metric | Recorded Value | Capital Preservation & Risk Metric | Recorded Value |`);
  lines.push(`|---|---|---|---|`);
  lines.push(
    `| **Initial Account Equity** | ${formatCurrency(initialBalance)} | **Maximum Equity Drawdown** | **${maxDd.toFixed(2)}%** |`
  );
  lines.push(
    `| **Final Account Equity** | ${formatCurrency(metrics.finalBalance)} | **Max Drawdown ($)** | ${formatCurrency(initialBalance * (maxDd / 100))} |`
  );
  lines.push(
    `| **Net Return ($ / %)** | **${formatCurrency(netDollar)}** (**${formatPercent(netPct)}**) | **Loss Streak (Max Consecutive)** | **${maxConsecutiveLosses}** trades (${maxLossDurationBars} bars / ~${maxLossDurationDays} days) |`
  );
  lines.push(
    `| **Realized Closed PnL** | ${formatCurrency(netDollar)} | **Market Exposure Ratio** | **${exposurePct}%** of total period |`
  );
  lines.push(
    `| **Unrealized Open PnL** | ${openTrade ? `${formatCurrency(openTrade.pnl)} (${formatPercent(openTrade.pnlPercent)})` : '$0.00 (No open position)'} | **Total Fees Paid** | ${formatCurrency(metrics.totalFees)} (${metrics.feeDragPercent.toFixed(2)}% fee drag) |`
  );
  lines.push(
    `| **Total Completed Trades** | **${completedTrades.length}** (Long: ${metrics.long.totalTrades} / Short: ${metrics.short.totalTrades}) | **Average Trade Holding Time** | **${avgDuration}** bars (Median: **${medianDuration}**, Max: **${maxDuration}**) |`
  );
  lines.push(
    `| **Win Rate** | **${winRateStr}** (${metrics.winningTrades}W / ${metrics.losingTrades}L) | **Total Profit Given Back** | ${formatCurrency(totalGivebackDollar)} (from peak MFE) |`
  );
  lines.push(
    `| **Profit Factor** | **${pfStr}** | **Trailing Stop Trigger Rate** | **${trailingTriggeredPct}%** (${trailingTriggeredTrades.length}/${completedTrades.length || 1} trades) |`
  );
  lines.push(
    `| **Trade Expectancy** | **${formatPercent(expectancy)}** per trade | **Average Win / Average Loss** | **+${metrics.averageWin.toFixed(2)}%** / **${metrics.averageLoss.toFixed(2)}%** (Ratio: **${winLossRatio}**) |`
  );
  lines.push(``);

  // Section 3: Every Completed Trade
  lines.push(`## Section 3: Every Completed Trade (Chronological Log)`);
  lines.push(`> ℹ️ **Table Conventions:**`);
  lines.push(`> - **Risk ($):** Initial cash risk budget at trade entry (\`positionValue × initialStopPercent\`).`);
  lines.push(`> - **MFE / MAE in R:** Maximum favorable/adverse excursion divided by initial stop distance.`);
  lines.push(`> - **Giveback:** Difference between peak unrealized gain (MFE) and final realized return.`);
  lines.push(``);
  lines.push(`| ID | Side | Entry Time (UTC) | Entry Price | Exit Time (UTC) | Exit Price | Qty | Pos Value | Risk ($) | Init Stop | Exit Reason | Gross PnL | Fee | Net PnL | Return % | MFE (R) | MAE (R) | Giveback % | Trailing Status |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);

  completedTrades.forEach((t, i) => {
    const id = `TR-${String(i + 1).padStart(3, '0')}`;
    const side = `\`${t.side.toUpperCase()}\``;
    const entryTime = formatDate(t.entryTime);
    const entryPrice = `$${t.entryPrice.toFixed(2)}`;
    const exitTime = formatDate(t.exitTime);
    const exitPrice = `$${t.exitPrice.toFixed(2)}`;
    const qty = t.quantity.toFixed(4);
    const posVal = `$${(t.quantity * t.entryPrice).toFixed(2)}`;
    const riskDollar = `$${((t.quantity * t.entryPrice) * (initialStopPercent / 100)).toFixed(2)}`;
    const initStop = `$${(t.side === 'long' ? t.entryPrice * (1 - initialStopPercent / 100) : t.entryPrice * (1 + initialStopPercent / 100)).toFixed(2)}`;
    const reason = `\`${t.exitReason}\``;
    const grossPnlVal = t.side === 'long' ? (t.exitPrice - t.entryPrice) * t.quantity : (t.entryPrice - t.exitPrice) * t.quantity;
    const grossPnl = formatCurrency(roundTo(grossPnlVal, 2));
    const fee = `$${t.fee.toFixed(2)}`;
    const netPnl = formatCurrency(t.pnl);
    const retPct = `**${formatPercent(t.pnlPercent)}**`;
    const mfe = t.maxFavorablePercent ?? 0;
    const mae = t.maxAdversePercent ?? 0;
    const mfeR = (mfe / initialStopPercent).toFixed(2);
    const maeR = (mae / initialStopPercent).toFixed(2);
    const mfeStr = `+${mfe.toFixed(1)}% (+${mfeR}R)`;
    const maeStr = `-${mae.toFixed(1)}% (-${maeR}R)`;
    const givebackPct = roundTo(Math.max(0, mfe - Math.max(0, t.pnlPercent ?? 0)), 1);
    const givebackStr = givebackPct > 0 ? `${givebackPct.toFixed(1)}%` : '0.0%';

    let trailingStatus = 'Disabled';
    if (config.trailingStop) {
      if ((t.ratchetSteps ?? 0) > 0) {
        trailingStatus = `Active (step ${t.ratchetSteps})`;
      } else {
        trailingStatus = `No (req: +${config.trailingStop.stepPercent}%)`;
      }
    }

    lines.push(
      `| ${id} | ${side} | ${entryTime} | ${entryPrice} | ${exitTime} | ${exitPrice} | ${qty} | ${posVal} | ${riskDollar} | ${initStop} | ${reason} | ${grossPnl} | ${fee} | ${netPnl} | ${retPct} | ${mfeStr} | ${maeStr} | ${givebackStr} | ${trailingStatus} |`
    );
  });
  lines.push(``);

  // Open position subsection
  lines.push(`### Open Position at Backtest Conclusion`);
  if (openTrade) {
    lines.push(`> ⚠️ **OPEN POSITION IDENTIFIED AT DATA END:**`);
    lines.push(`| Attribute | Value | Analysis |`);
    lines.push(`|---|---|---|`);
    lines.push(`| **Position ID** | \`TR-${trades.length}\` | Active at final candle |`);
    lines.push(`| **Direction** | \`${openTrade.side.toUpperCase()}\` | Position opened during run |`);
    lines.push(
      `| **Entry Timestamp / Price** | \`${formatDate(openTrade.entryTime)}\` / $${openTrade.entryPrice.toFixed(2)} | Original entry execution |`
    );
    lines.push(`| **Final Historical Price** | $${openTrade.exitPrice.toFixed(2)} | Evaluated at final candle close |`);
    lines.push(
      `| **Position Size / Value** | ${openTrade.quantity.toFixed(4)} ($${(openTrade.quantity * openTrade.entryPrice).toFixed(2)}) | Capital in trade |`
    );
    lines.push(
      `| **Unrealized Net PnL** | **${formatCurrency(openTrade.pnl)}** (**${formatPercent(openTrade.pnlPercent)}**) | Marked-to-market at close |`
    );
    lines.push(
      `| **Accounting Status** | **UNCLOSED POSITION** | **Excluded from closed realized trade statistics** |`
    );
  } else {
    lines.push(`> ℹ️ **Status:** No open position remained at backtest conclusion. All trades completed natural exits.`);
  }
  lines.push(``);

  // Section 4: Risk, Drawdown & Exposure Diagnostics
  lines.push(`## Section 4: Risk, Drawdown & Exposure Diagnostics`);
  lines.push(`### 1. Top Drawdown Periods`);
  if (drawdowns.length === 0) {
    lines.push(`> No drawdowns exceeding 0.1% were detected.`);
  } else {
    lines.push(
      `| # | Peak Date | Peak Equity | Trough Date | Trough Equity | Max Depth % | Bars to Trough | Recovery Date | Recovery Status |`
    );
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    drawdowns.forEach((dd, idx) => {
      const peakDate = formatDate(dd.peakTime);
      const troughDate = formatDate(dd.troughTime);
      const recDate = dd.recoveryTime ? formatDate(dd.recoveryTime) : 'Unrecovered';
      const status = dd.isRecovered ? '✅ Recovered' : '⚠️ Active Drawdown';
      lines.push(
        `| ${idx + 1} | ${peakDate} | $${dd.peakEquity.toFixed(2)} | ${troughDate} | $${dd.troughEquity.toFixed(2)} | **${dd.depthPercent.toFixed(2)}%** | ${dd.barsToTrough} bars | ${recDate} | ${status} |`
      );
    });
  }
  lines.push(``);

  // Exit Reason Distribution
  lines.push(`### 2. Exit Reason Distribution`);
  const exitGroups = new Map<string, { count: number; netPnl: number; retPctSum: number; durationSum: number }>();
  for (const t of completedTrades) {
    const reason = t.exitReason || 'unknown';
    const entry = exitGroups.get(reason) ?? { count: 0, netPnl: 0, retPctSum: 0, durationSum: 0 };
    entry.count++;
    entry.netPnl += t.pnl || 0;
    entry.retPctSum += t.pnlPercent || 0;
    entry.durationSum += tradeDurationBars.get(t) ?? 0;
    exitGroups.set(reason, entry);
  }
  lines.push(
    `| Exit Reason | Trade Count | Percentage | Cumulative Net PnL | Cumulative Return % | Avg Return % | Avg Holding Bars |`
  );
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const [reason, g] of exitGroups.entries()) {
    const share = roundTo((g.count / (completedTrades.length || 1)) * 100, 1);
    const avgRet = roundTo(g.retPctSum / g.count, 2);
    const avgDur = roundTo(g.durationSum / g.count, 1);
    lines.push(
      `| \`${reason}\` | ${g.count} | ${share}% | ${formatCurrency(roundTo(g.netPnl, 2))} | ${formatPercent(roundTo(g.retPctSum, 2))} | ${formatPercent(avgRet)} | ${avgDur} bars |`
    );
  }
  lines.push(``);

  // Yearly Breakdown
  lines.push(`### 3. Yearly Performance Breakdown`);
  const yearGroups = new Map<number, { count: number; wins: number; pnl: number; retPct: number }>();
  for (const t of completedTrades) {
    const yr = t.entryTime ? new Date(t.entryTime).getUTCFullYear() : 0;
    const entry = yearGroups.get(yr) ?? { count: 0, wins: 0, pnl: 0, retPct: 0 };
    entry.count++;
    if ((t.pnl || 0) > 0) entry.wins++;
    entry.pnl += t.pnl || 0;
    entry.retPct += t.pnlPercent || 0;
    yearGroups.set(yr, entry);
  }
  lines.push(`| Calendar Year | Trade Count | Win Rate | Net PnL ($) | Cumulative Return % | Avg Return % |`);
  lines.push(`|---|---|---|---|---|---|`);
  const sortedYears = Array.from(yearGroups.keys()).sort((a, b) => a - b);
  for (const yr of sortedYears) {
    const g = yearGroups.get(yr)!;
    const wr = `${roundTo((g.wins / g.count) * 100, 1)}%`;
    const avgRet = roundTo(g.retPct / g.count, 2);
    lines.push(
      `| **${yr || 'N/A'}** | ${g.count} | ${wr} | ${formatCurrency(roundTo(g.pnl, 2))} | ${formatPercent(roundTo(g.retPct, 2))} | ${formatPercent(avgRet)} |`
    );
  }
  lines.push(``);

  // Section 5: Decision & Signal Funnel Diagnostics
  lines.push(`## Section 5: Decision & Signal Funnel Diagnostics`);
  const trace = backtestResult.trace;
  if (!trace) {
    lines.push(`> ℹ️ Passive signal tracing was not enabled for this backtest run (\`collectTrace: false\`).`);
  } else {
    const tkCrossEvents = trace.tkCrossEvents ?? [];
    const ignoredSignals = trace.ignoredSignals ?? [];

    const tkCrossUpCount = tkCrossEvents.filter((e) => e.direction === 'up').length;
    const tkCrossDownCount = tkCrossEvents.filter((e) => e.direction === 'down').length;
    const crossUpInZone = tkCrossEvents.filter((e) => e.direction === 'up' && e.inRsiZone).length;
    const crossDownInZone = tkCrossEvents.filter((e) => e.direction === 'down' && e.inRsiZone).length;
    const buySignalsEmitted = tkCrossEvents.filter((e) => e.direction === 'up' && e.signalEmitted).length;
    const sellSignalsEmitted = tkCrossEvents.filter((e) => e.direction === 'down' && e.signalEmitted).length;

    const rejectedCrosses = tkCrossEvents.filter((e) => !e.signalEmitted);
    const cloudFilterRejections = rejectedCrosses.filter((e) => e.filterRejection === 'cloudFilter').length;
    const rsiOutOfZoneRejections = rejectedCrosses.filter((e) => e.filterRejection === 'rsiOutOfZone').length;
    const rsiRecoveryCapRejections = rejectedCrosses.filter((e) => e.filterRejection === 'rsiRecoveryCap').length;
    const kijunSlopeFilterRejections = rejectedCrosses.filter((e) => e.filterRejection === 'kijunSlopeFilter').length;

    const ignoredAlreadyInPos = ignoredSignals.filter((e) => e.reason === 'alreadyInPosition').length;
    const ignoredLongOnlyShort = ignoredSignals.filter((e) => e.reason === 'longOnlyShortIgnored').length;
    const ignoredCapPositions = ignoredSignals.filter((e) => e.reason === 'cap_positions').length;
    const ignoredCapExposure = ignoredSignals.filter((e) => e.reason === 'cap_exposure').length;
    const ignoredMinBars = ignoredSignals.filter((e) => e.reason === 'min_bars').length;
    const multiPosDiag = backtestResult.multiPositionDiagnostics;

    lines.push(`### 1. Signal Funnel`);
    lines.push(`| Stage | Bullish (BUY) | Bearish (SELL) | Combined |`);
    lines.push(`|---|---|---|---|`);
    lines.push(`| **TK Crossover Events** | ${tkCrossUpCount} | ${tkCrossDownCount} | ${tkCrossUpCount + tkCrossDownCount} |`);
    lines.push(`| **Crosses with RSI in Zone** | ${crossUpInZone} | ${crossDownInZone} | ${crossUpInZone + crossDownInZone} |`);
    lines.push(`| **Signals Emitted by Strategy** | ${buySignalsEmitted} | ${sellSignalsEmitted} | ${buySignalsEmitted + sellSignalsEmitted} |`);
    lines.push(`| **Signals Executed into Trades** | ${metrics.long.totalTrades} | ${metrics.short.totalTrades} | ${metrics.totalTrades} |`);
    lines.push(``);

    lines.push(`### 2. Filter Rejection Attribution`);
    lines.push(`- **Rejected Crossovers (Did Not Emit Signal):** ${rejectedCrosses.length}`);
    lines.push(`  - Cloud Trend Filter (\`close vs Cloud\`): **${cloudFilterRejections}**`);
    lines.push(`  - RSI Out of Zone at Cross & Lookback: **${rsiOutOfZoneRejections}**`);
    lines.push(`  - RSI Recovery Cap Exceeded: **${rsiRecoveryCapRejections}**`);
    lines.push(`  - Kijun Slope Filter: **${kijunSlopeFilterRejections}**`);
    lines.push(`- **Ignored Signals (Strategy Emitted but Engine Skipped):** ${ignoredSignals.length}`);
    lines.push(`  - Position Already Open in Same Direction: **${ignoredAlreadyInPos}**`);
    lines.push(`  - Long-Only Filter Ignored Short: **${ignoredLongOnlyShort}**`);
    if (ignoredCapPositions > 0) {
      lines.push(`  - Multi-position Cap Reached: **${ignoredCapPositions}**`);
    }
    if (ignoredCapExposure > 0) {
      lines.push(`  - Max Total Exposure Reached: **${ignoredCapExposure}**`);
    }
    if (ignoredMinBars > 0) {
      lines.push(`  - Min Bars Between Entries Not Met: **${ignoredMinBars}**`);
    }
    if (multiPosDiag && (multiPosDiag.maxConcurrentPositions > 1 || multiPosDiag.percentTimeAtCapacity > 0)) {
      lines.push(`  - Avg / Max Concurrency: **${multiPosDiag.avgConcurrentPositions} / ${multiPosDiag.maxConcurrentPositions}** (Time at cap: **${multiPosDiag.percentTimeAtCapacity}%**)`);
    }
    lines.push(``);
  }

  // Warnings
  lines.push(`### 3. Execution & Behavioral Warnings`);
  if (flags.length === 0) {
    lines.push(`> No critical execution warnings were triggered during this run.`);
  } else {
    for (const flag of flags) {
      lines.push(`- [${flag.level}] ${flag.message}`);
    }
  }
  lines.push(``);

  // Invariant Self-Checks
  lines.push(`### 4. Invariant Self-Checks`);
  lines.push(`| Invariant Name | Status | Violations | Verification Details |`);
  lines.push(`|---|---|---|---|`);
  for (const inv of invariantResults) {
    let iconText: string;
    if (inv.status === 'PASS') iconText = '✅ PASS';
    else if (inv.status === 'FAIL') iconText = '❌ FAIL';
    else if (inv.status === 'INCOMPLETE') iconText = '⚠️ INCOMPLETE';
    else iconText = '⚪ N/A';
    lines.push(`| **${inv.name}** | ${iconText} | ${inv.violations} | ${inv.details} |`);
  }
  lines.push(``);

  // Section 6: Reproduction & Maintenance
  lines.push(`## Section 6: Reproduction & Report Lifecycle`);
  lines.push(`- **Canonical Diagnostics Report:** \`docs/review/TRADE_DIAGNOSTICS_LATEST.md\``);
  lines.push(`- **Automatic Regeneration:** This report automatically refreshes after every supported backtest run:`);
  lines.push(`  \`\`\`bash`);
  lines.push(`  npx tsx src/scripts/backtest-report.ts --symbol=${config.symbol} --period=${config.period ?? '6y'}`);
  lines.push(`  \`\`\``);
  lines.push(
    `- **Determinism Guarantee:** Every trade record, execution timestamp, and metric is deterministically derived from dataset fingerprint \`${datasetFingerprint}\` and config hash \`${configHash}\`.`
  );
  lines.push(``);

  return lines.join('\n');
}

export function formatHistoryWinRate(
  winRate: number | null | undefined,
  totalTrades: number
): string {
  if (totalTrades === 0 || winRate === null || winRate === undefined || !Number.isFinite(winRate)) {
    return 'N/A';
  }
  return `${(winRate * 100).toFixed(1)}%`;
}

export function formatHistoryRow(params: {
  dateFormatted: string;
  commitShort: string;
  confHash: string;
  symIntPer: string;
  strategy?: string;
  netReturnPercent: number;
  totalTrades: number;
  maxDrawdownPercent: number;
  winRate: number | null | undefined;
  filename: string;
}): string {
  const retPct = formatPercent(params.netReturnPercent);
  const maxDd = `${params.maxDrawdownPercent.toFixed(2)}%`;
  const wr = formatHistoryWinRate(params.winRate, params.totalTrades);
  const relLink = `[Report](history/${params.filename})`;
  const displaySym = params.strategy ? `${params.symIntPer} (${params.strategy})` : params.symIntPer;
  return `| ${params.dateFormatted} | \`${params.commitShort}\` | \`${params.confHash}\` | ${displaySym} | **${retPct}** | ${params.totalTrades} | ${maxDd} | ${wr} | ${relLink} |`;
}

export async function saveBacktestReport(output: BacktestReportOutput): Promise<{
  latestMdPath: string;
  latestJsonPath: string;
  historyMdPath: string;
  historyIndexUpdated: boolean;
  diagnosticsMdPath?: string;
}> {
  const rootDir = process.cwd();
  const reviewDir = path.join(rootDir, 'docs', 'review');
  const historyDir = path.join(reviewDir, 'history');

  await fs.mkdir(historyDir, { recursive: true });

  const latestMdPath = path.join(reviewDir, 'BACKTEST_LATEST.md');
  const latestJsonPath = path.join(reviewDir, 'backtest-latest.json');
  const historyMdPath = path.join(historyDir, output.filename);
  const diagnosticsMdPath = path.join(reviewDir, 'TRADE_DIAGNOSTICS_LATEST.md');

  // 1. Write BACKTEST_LATEST.md & backtest-latest.json
  await fs.writeFile(latestMdPath, output.markdown, 'utf-8');
  await fs.writeFile(latestJsonPath, JSON.stringify(output.json, null, 2), 'utf-8');

  // 2. Write archive file in history/
  await fs.writeFile(historyMdPath, output.markdown, 'utf-8');

  // 2b. Write TRADE_DIAGNOSTICS_LATEST.md
  if (output.diagnosticsMarkdown) {
    await fs.writeFile(diagnosticsMdPath, output.diagnosticsMarkdown, 'utf-8');
  }

  // 3. Prune history: preservation policy (do not delete any historical runs)

  // 4. Update HISTORY.md index table
  let historyIndexUpdated = false;
  try {
    const historyIndexPath = path.join(reviewDir, 'HISTORY.md');
    const meta = output.json.meta as Record<string, unknown>;
    const summary = output.json.summary as Record<string, unknown>;

    const dateFormatted = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const commitShort = (meta.gitCommit as string) || 'unknown';
    const confHash = output.configHash;
    const symIntPer = `${meta.symbol} / ${meta.interval} / ${meta.period}`;
    const retPct = (summary.netReturnPercent as number) ?? 0;
    const trCount = (summary.totalTrades as number) ?? 0;
    const maxDd = (summary.maxDrawdownPercent as number) ?? 0;
    const wrVal = summary.winRate as number | null | undefined;
    const configObj = (meta.config as BacktestReportConfig) ?? {};
    const strategyName = formatStrategyDisplayName(configObj);

    const tableHeader = `# Backtest Run History\n\n| Timestamp (UTC) | Git Commit | Config Hash | Symbol / Interval / Period | Return % | Trades | Max DD % | Win Rate % | Archive |\n|---|---|---|---|---|---|---|---|---|`;
    const newRow = formatHistoryRow({
      dateFormatted,
      commitShort,
      confHash,
      symIntPer,
      strategy: strategyName,
      netReturnPercent: retPct,
      totalTrades: trCount,
      maxDrawdownPercent: maxDd,
      winRate: wrVal,
      filename: output.filename,
    });

    let existingContent = '';
    try {
      existingContent = await fs.readFile(historyIndexPath, 'utf-8');
    } catch {
      existingContent = '';
    }

    if (!existingContent || !existingContent.includes('| Timestamp (UTC) |')) {
      const fullHistoryMd = `${tableHeader}\n${newRow}\n`;
      await fs.writeFile(historyIndexPath, fullHistoryMd, 'utf-8');
    } else {
      // Insert newRow directly after the last table row, preserving any notes at the bottom
      const contentLines = existingContent.split('\n');
      let lastTableRowIdx = -1;
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim().startsWith('|')) {
          lastTableRowIdx = i;
        }
      }
      if (lastTableRowIdx !== -1 && lastTableRowIdx < contentLines.length - 1) {
        contentLines.splice(lastTableRowIdx + 1, 0, newRow);
        await fs.writeFile(historyIndexPath, contentLines.join('\n'), 'utf-8');
      } else {
        const updatedHistoryMd = `${existingContent.trim()}\n${newRow}\n`;
        await fs.writeFile(historyIndexPath, updatedHistoryMd, 'utf-8');
      }
    }
    historyIndexUpdated = true;
  } catch (err) {
    console.warn('Failed to update HISTORY.md:', err);
  }

  return {
    latestMdPath,
    latestJsonPath,
    historyMdPath,
    historyIndexUpdated,
    diagnosticsMdPath,
  };
}

export async function generateAndSaveBacktestReport(
  input: BacktestReportInput
): Promise<{ report: BacktestReportOutput; paths: SaveReportPaths }> {
  const report = buildBacktestReport(input);
  const paths = await saveBacktestReport(report);
  return { report, paths };
}
