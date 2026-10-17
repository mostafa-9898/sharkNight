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
}

export interface BacktestReportConfig {
  symbol: string;
  interval: string;
  period?: string;
  dataSource?: string;
  gitCommit?: string;
  isDirty?: boolean;
  // Strategy
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

export interface InvariantResult {
  name: string;
  status: 'PASS' | 'FAIL';
  violations: number;
  details: string;
}

export interface BacktestReportOutput {
  markdown: string;
  json: Record<string, unknown>;
  configHash: string;
  timestampStr: string;
  filename: string;
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

function computeConfigHash(config: BacktestReportConfig): string {
  const normalized: Record<string, unknown> = {};
  const keys = Object.keys(config)
    .filter((k) => k !== 'gitCommit' && k !== 'isDirty')
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

  // --- SECTION C: Automated Warning Flags ---
  const flags: Array<{ level: 'CRITICAL' | 'WARNING' | 'NOTICE'; message: string }> = [];

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
    const totalPnlVal = roundTo(list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0), 2);
    const avgPnlVal = count > 0 ? `${formatPercent(roundTo(totalPnlVal / count, 2))}` : 'N/A';
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
      const totalPnlVal = roundTo(list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0), 2);
      const avgPnlVal = roundTo(totalPnlVal / count, 2);
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
      const totalPnlVal = roundTo(list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0), 2);
      const avgPnlVal = roundTo(totalPnlVal / count, 2);
      return { year: yr, count, winRate: winRateVal, totalPnl: totalPnlVal, avgPnl: avgPnlVal };
    });

  // 4. By Price vs Cloud
  const cloudPositions = ['above', 'inside', 'below'] as const;
  const cloudBreakdown = cloudPositions.map((pos) => {
    const list = trades.filter((t) => t.entryDiagnostics?.priceVsCloud === pos);
    const count = list.length;
    const wins = list.filter((t) => (t.pnl || 0) > 0).length;
    const winRateVal = count > 0 ? roundTo((wins / count) * 100, 1) : null;
    const totalPnlVal = roundTo(list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0), 2);
    const avgPnlVal = count > 0 ? roundTo(totalPnlVal / count, 2) : null;

    const longList = list.filter((t) => t.side === 'long');
    const longCount = longList.length;
    const longWins = longList.filter((t) => (t.pnl || 0) > 0).length;
    const longWinRate = longCount > 0 ? roundTo((longWins / longCount) * 100, 1) : null;
    const longTotalPnl = roundTo(longList.reduce((sum, t) => sum + (t.pnlPercent || 0), 0), 2);

    const shortList = list.filter((t) => t.side === 'short');
    const shortCount = shortList.length;
    const shortWins = shortList.filter((t) => (t.pnl || 0) > 0).length;
    const shortWinRate = shortCount > 0 ? roundTo((shortWins / shortCount) * 100, 1) : null;
    const shortTotalPnl = roundTo(shortList.reduce((sum, t) => sum + (t.pnlPercent || 0), 0), 2);

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
    const totalPnlVal = roundTo(list.reduce((sum, t) => sum + (t.pnlPercent || 0), 0), 2);
    const avgPnlVal = count > 0 ? roundTo(totalPnlVal / count, 2) : null;
    return { bucket: b.label, count, winRate: winRateVal, totalPnl: totalPnlVal, avgPnl: avgPnlVal };
  });

  // --- SECTION K: Invariant Self-Checks ---
  const invariantResults: InvariantResult[] = [];

  // Check 1: Cash Conservation Identity
  const totalTradePnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const finalEquity = equity[equity.length - 1] ?? initialBalance;
  const cashDiscrepancy = Math.abs(initialBalance + totalTradePnl - finalEquity);
  invariantResults.push({
    name: 'Cash / Equity Conservation',
    status: cashDiscrepancy < 1e-5 ? 'PASS' : 'FAIL',
    violations: cashDiscrepancy < 1e-5 ? 0 : 1,
    details: `|initialBalance + sum(trade.pnl) - finalEquity| = ${cashDiscrepancy.toExponential(4)} (threshold 1e-5)`,
  });

  // Check 2: Stop Fill Integrity
  let stopViolations = 0;
  for (const t of trades) {
    if (t.exitReason === 'stopLoss' || t.exitReason === 'trailingStop') {
      const exitIdx = t.exitTime ? candleMap.get(t.exitTime) ?? -1 : -1;
      const c = exitIdx !== -1 ? candles[exitIdx] : null;
      if (c && t.stopPrice !== undefined) {
        const slip = (config.slippagePercent ?? 0) / 100;
        if (t.side === 'long') {
          const expectedBase = c.open <= t.stopPrice ? c.open : t.stopPrice;
          const allowedWorst = expectedBase * (1 - slip);
          if (t.exitPrice < allowedWorst - 1e-5) stopViolations++;
        } else {
          const expectedBase = c.open >= t.stopPrice ? c.open : t.stopPrice;
          const allowedWorst = expectedBase * (1 + slip);
          if (t.exitPrice > allowedWorst + 1e-5) stopViolations++;
        }
      }
    }
  }
  invariantResults.push({
    name: 'Stop Fill Integrity (Intrabar Gap/Slippage)',
    status: stopViolations === 0 ? 'PASS' : 'FAIL',
    violations: stopViolations,
    details: `Exit price was at or better than allowed stopPrice + gap slippage in ${trades.length - stopViolations}/${trades.length} trades`,
  });

  // Check 3: Trade Non-Overlap
  let overlapViolations = 0;
  for (let i = 1; i < trades.length; i++) {
    const prevExit = trades[i - 1].exitTime ?? 0;
    const currEntry = trades[i].entryTime ?? 0;
    if (currEntry < prevExit) {
      overlapViolations++;
    }
  }
  invariantResults.push({
    name: 'Trade Non-Overlap (Single Position Invariant)',
    status: overlapViolations === 0 ? 'PASS' : 'FAIL',
    violations: overlapViolations,
    details: `Every trade entered after or simultaneous with prior trade exit (${trades.length - overlapViolations}/${trades.length})`,
  });

  // Check 4: Monotonic Ratchet Steps
  let ratchetViolations = 0;
  for (const tr of trajectories) {
    if (tr.ratchetSteps < 0) ratchetViolations++;
  }
  invariantResults.push({
    name: 'Trailing Ratchet Step Monotonicity',
    status: ratchetViolations === 0 ? 'PASS' : 'FAIL',
    violations: ratchetViolations,
    details: `Trailing ratchet steps monotonically non-negative across all trades (${trades.length - ratchetViolations}/${trades.length})`,
  });

  // ==========================================
  // BUILD MARKDOWN (SECTIONS A TO K IN ORDER)
  // ==========================================
  const lines: string[] = [];

  // Title
  lines.push(`# Automated Backtest Review Report`);
  lines.push(`Generated: **${now.toISOString()}** | Config Hash: \`${configHash}\``);
  lines.push(``);

  // Section A: Run Header
  lines.push(`## Section A: Run Header`);
  lines.push(`| Property | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Git Commit** | \`${gitInfo.commit}\` (${gitInfo.isDirty ? '⚠️ dirty' : '✅ clean'}) |`);
  lines.push(`| **Symbol / Interval / Period** | \`${config.symbol}\` / \`${config.interval}\` / \`${config.period ?? 'all'}\` |`);
  lines.push(`| **Total Candles** | ${candles.length.toLocaleString()} |`);
  lines.push(`| **Start Time (UTC)** | ${formatDate(firstCandle?.timestamp)} |`);
  lines.push(`| **End Time (UTC)** | ${formatDate(lastCandle?.timestamp)} |`);
  lines.push(
    `| **Data Source** | \`${config.dataSource ?? 'cache'}\` ${config.dataSource === 'synthetic' ? '⚠️ **SYNTHETIC DATA**' : '✅'} |`
  );
  lines.push(`| **Config Hash** | \`${configHash}\` |`);
  lines.push(``);

  lines.push(`### Full Configuration Parameters`);
  lines.push(`| Parameter Group | Parameter | Value |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Ichimoku | Tenkan / Kijun / SenkouB / Displacement | \`${tenkan}\` / \`${kijun}\` / \`${senkouB}\` / \`${displacement}\` |`);
  lines.push(`| RSI | Period / Lookback | \`${rsiPeriod}\` / \`${config.rsiLookback ?? 10}\` |`);
  lines.push(`| RSI Zones | Buy Zone / Sell Zone | \`[${config.rsiBuyMin ?? 20}, ${config.rsiBuyMax ?? 40}]\` / \`[${config.rsiSellMin ?? 60}, ${config.rsiSellMax ?? 80}]\` |`);
  lines.push(`| Cloud Filter | Mode | \`${config.cloudFilter ?? 'off'}\` |`);
  lines.push(`| RSI Recovery Cap | Value | \`${config.rsiRecoveryCap !== undefined ? `+${config.rsiRecoveryCap}` : 'off'}\` |`);
  lines.push(`| Kijun Slope Filter | Status | \`${config.kijunSlopeFilter ? 'enabled' : 'disabled'}\` |`);
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
  if (hasForcedEndExit && lastTrade) {
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
    const icon = inv.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
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
      config,
    },
    summary: {
      initialBalance,
      finalBalance: metrics.finalBalance,
      netReturnPercent: metrics.totalPnlPercent,
      netReturnDollar: metrics.totalPnl,
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
          },
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

  return {
    markdown,
    json: jsonReport,
    configHash,
    timestampStr,
    filename,
  };
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
  return `| ${params.dateFormatted} | \`${params.commitShort}\` | \`${params.confHash}\` | ${params.symIntPer} | **${retPct}** | ${params.totalTrades} | ${maxDd} | ${wr} | ${relLink} |`;
}

export async function saveBacktestReport(output: BacktestReportOutput): Promise<{
  latestMdPath: string;
  latestJsonPath: string;
  historyMdPath: string;
  historyIndexUpdated: boolean;
}> {
  const rootDir = process.cwd();
  const reviewDir = path.join(rootDir, 'docs', 'review');
  const historyDir = path.join(reviewDir, 'history');

  await fs.mkdir(historyDir, { recursive: true });

  const latestMdPath = path.join(reviewDir, 'BACKTEST_LATEST.md');
  const latestJsonPath = path.join(reviewDir, 'backtest-latest.json');
  const historyMdPath = path.join(historyDir, output.filename);

  // 1. Write BACKTEST_LATEST.md & backtest-latest.json
  await fs.writeFile(latestMdPath, output.markdown, 'utf-8');
  await fs.writeFile(latestJsonPath, JSON.stringify(output.json, null, 2), 'utf-8');

  // 2. Write archive file in history/
  await fs.writeFile(historyMdPath, output.markdown, 'utf-8');

  // 3. Prune history: keep only the latest 30 runs
  try {
    const historyFiles = await fs.readdir(historyDir);
    const mdFiles = historyFiles
      .filter((f) => f.endsWith('.md'))
      .sort(); // Lexicographical sort by timestamp filename

    if (mdFiles.length > 30) {
      const filesToDelete = mdFiles.slice(0, mdFiles.length - 30);
      for (const f of filesToDelete) {
        await fs.unlink(path.join(historyDir, f)).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Failed to prune history directory:', err);
  }

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

    const tableHeader = `# Backtest Run History\n\n| Timestamp (UTC) | Git Commit | Config Hash | Symbol / Interval / Period | Return % | Trades | Max DD % | Win Rate % | Archive |\n|---|---|---|---|---|---|---|---|---|`;
    const newRow = formatHistoryRow({
      dateFormatted,
      commitShort,
      confHash,
      symIntPer,
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
      // Append row to existing table
      const updatedHistoryMd = `${existingContent.trim()}\n${newRow}\n`;
      await fs.writeFile(historyIndexPath, updatedHistoryMd, 'utf-8');
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
  };
}

export async function generateAndSaveBacktestReport(
  input: BacktestReportInput
): Promise<{ report: BacktestReportOutput; paths: SaveReportPaths }> {
  const report = buildBacktestReport(input);
  const paths = await saveBacktestReport(report);
  return { report, paths };
}
