import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from '../strategies/types';

export type TradeMode = 'long-short' | 'long-only';
export type TradeSide = 'long' | 'short';
export type ExitReason = 'signal' | 'reverse' | 'takeProfit' | 'stopLoss' | 'end';

export interface BacktestConfig {
  strategy: Strategy;
  candles: readonly Candle[];
  initialBalance: number;
  tradeFeePercent?: number;       // e.g., 0.1 for 0.1%
  positionSizePercent?: number;   // e.g., 100 for 100% of balance
  tradeMode?: TradeMode;          // DEFAULT: 'long-short'
  takeProfitPercent?: number;     // e.g., 5 for 5% TP
  stopLossPercent?: number;       // e.g., 3 for 3% SL
}

export interface Trade {
  side: TradeSide;
  exitReason: ExitReason;
  entrySignal: TradeSignal;
  exitSignal: TradeSignal;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  fee: number;
  entryTime?: number;
  exitTime?: number;
  duration?: number;
}

export interface ActivePosition {
  symbol?: string;
  side: TradeSide;
  entrySignal: TradeSignal;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  investedCost: number;
  entryFee: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryTime: number;
  duration: number;
}

export interface SideMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;                // 0-1
  totalPnl: number;
  totalPnlPercent: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;                // 0-1
  totalPnl: number;
  totalPnlPercent: number;
  maxDrawdown: number;            // 0-1
  maxDrawdownPercent: number;
  sharpeRatio: number;
  averageTradeReturn: number;
  bestTrade: number;
  worstTrade: number;
  finalBalance: number;
  long: SideMetrics;
  short: SideMetrics;
}

export interface BacktestResult {
  config: Omit<BacktestConfig, 'candles'>;
  trades: Trade[];
  metrics: BacktestMetrics;
  equity: number[];               // Equity curve over time
  activePosition?: ActivePosition | null;
}
