import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from '../strategies/types';

export interface BacktestConfig {
  strategy: Strategy;
  candles: Candle[];
  initialBalance: number;
  tradeFeePercent?: number;   // e.g., 0.1 for 0.1%
  positionSizePercent?: number; // e.g., 100 for 100% of balance
}

export interface Trade {
  entrySignal: TradeSignal;
  exitSignal: TradeSignal;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  fee: number;
}

export interface BacktestResult {
  config: Omit<BacktestConfig, 'candles'>;
  trades: Trade[];
  metrics: BacktestMetrics;
  equity: number[];           // Equity curve over time
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;            // 0-1
  totalPnl: number;
  totalPnlPercent: number;
  maxDrawdown: number;        // 0-1
  maxDrawdownPercent: number;
  sharpeRatio: number;
  averageTradeReturn: number;
  bestTrade: number;
  worstTrade: number;
  finalBalance: number;
}
