import type { Trade } from '../backtest/types';
import type { DailyRegimeCalculator } from './market-regime';
import { roundTo } from './math';

export interface TradeCsvRow {
  side: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  pnlUsd: number;
  exitReason: string;
  mfe: number;
  mae: number;
  bars: number;
  concurrentOpenAtEntry: number;
  htfDirAtEntry: string;
  regime: 'bull' | 'bear';
  triggerType: 'tk' | 'stoch' | 'fisher';
}

export function formatTradeRow(
  trade: Trade,
  intervalMs: number,
  regimeCalc: DailyRegimeCalculator
): TradeCsvRow {
  const entryTime = trade.entryTime ?? 0;
  const exitTime = trade.exitTime ?? 0;
  const bars = Math.max(1, Math.round((exitTime - entryTime) / intervalMs));
  const regime = regimeCalc.getRegimeAt(entryTime);

  const meta = (trade.entrySignal?.metadata ?? {}) as Record<string, unknown>;
  let triggerType: 'tk' | 'stoch' | 'fisher' = 'tk';
  if (meta.ichiCross) {
    triggerType = 'tk';
  } else if (meta.stochCross) {
    triggerType = 'stoch';
  } else if (meta.fisherCross) {
    triggerType = 'fisher';
  } else if (trade.entrySignal?.reason?.includes('fisher')) {
    triggerType = 'fisher';
  } else if (trade.entrySignal?.reason?.includes('stoch')) {
    triggerType = 'stoch';
  }

  const htfDirAtEntry = trade.side === 'long' ? 'bullish' : 'bearish';

  return {
    side: trade.side,
    entryTime,
    exitTime,
    entryPrice: roundTo(trade.entryPrice, 4),
    exitPrice: roundTo(trade.exitPrice, 4),
    pnlPct: roundTo(trade.pnlPercent, 4),
    pnlUsd: roundTo(trade.pnl, 4),
    exitReason: trade.exitReason,
    mfe: roundTo(trade.maxFavorablePercent, 4),
    mae: roundTo(trade.maxAdversePercent, 4),
    bars,
    concurrentOpenAtEntry: trade.concurrentOpenAtEntry ?? 1,
    htfDirAtEntry,
    regime,
    triggerType,
  };
}

export const TRADE_CSV_HEADER =
  'side,entryTime,exitTime,entryPrice,exitPrice,pnlPct,pnlUsd,exitReason,mfe,mae,bars,concurrentOpenAtEntry,htfDirAtEntry,regime,triggerType';

export function serializeTradeRows(rows: TradeCsvRow[]): string {
  const lines = [TRADE_CSV_HEADER];
  for (const r of rows) {
    lines.push(
      `${r.side},${r.entryTime},${r.exitTime},${r.entryPrice},${r.exitPrice},${r.pnlPct},${r.pnlUsd},${r.exitReason},${r.mfe},${r.mae},${r.bars},${r.concurrentOpenAtEntry},${r.htfDirAtEntry},${r.regime},${r.triggerType}`
    );
  }
  return lines.join('\n') + '\n';
}

export function parseTradeRows(csvContent: string): TradeCsvRow[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length <= 1) return [];
  return lines.slice(1).map((l) => {
    const parts = l.split(',');
    return {
      side: parts[0],
      entryTime: Number(parts[1]),
      exitTime: Number(parts[2]),
      entryPrice: Number(parts[3]),
      exitPrice: Number(parts[4]),
      pnlPct: Number(parts[5]),
      pnlUsd: Number(parts[6]),
      exitReason: parts[7],
      mfe: Number(parts[8]),
      mae: Number(parts[9]),
      bars: Number(parts[10]),
      concurrentOpenAtEntry: Number(parts[11]),
      htfDirAtEntry: parts[12],
      regime: parts[13] as 'bull' | 'bear',
      triggerType: parts[14] as 'tk' | 'stoch' | 'fisher',
    };
  });
}

