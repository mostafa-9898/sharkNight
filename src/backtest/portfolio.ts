import type { TradeSignal } from '../data/models';
import type { Trade } from './types';

export interface PortfolioOptions {
  initialBalance: number;
  tradeFeePercent?: number;     // e.g. 0.1 for 0.1%
  positionSizePercent?: number; // e.g. 100 for 100% of cash
}

export interface OpenPosition {
  quantity: number;
  entryPrice: number;
  entrySignal: TradeSignal;
  entryCost: number;
  entryFee: number;
  entryTime: number;
}

export class VirtualPortfolio {
  readonly initialBalance: number;
  readonly tradeFeePercent: number;
  readonly positionSizePercent: number;

  private cash: number;
  private currentPosition: OpenPosition | null = null;
  private completedTrades: Trade[] = [];

  constructor(options: PortfolioOptions) {
    if (options.initialBalance <= 0) {
      throw new Error(`Initial balance must be positive, got ${options.initialBalance}`);
    }

    this.initialBalance = options.initialBalance;
    this.cash = options.initialBalance;
    this.tradeFeePercent = Math.max(0, options.tradeFeePercent ?? 0.1);
    this.positionSizePercent = Math.min(100, Math.max(1, options.positionSizePercent ?? 100));
  }

  /**
   * Current available cash not committed to an open trade.
   */
  getCash(): number {
    return this.cash;
  }

  /**
   * Array of closed, realized trades.
   */
  getTrades(): Trade[] {
    return [...this.completedTrades];
  }

  /**
   * Current active open position or null.
   */
  getOpenPosition(): OpenPosition | null {
    return this.currentPosition ? { ...this.currentPosition } : null;
  }

  /**
   * Whether the portfolio currently holds an open asset position.
   */
  hasOpenPosition(): boolean {
    return this.currentPosition !== null;
  }

  /**
   * Opens a new position if no position is currently open and cash is available.
   */
  openPosition(signal: TradeSignal, currentPrice: number, timestamp: number): boolean {
    if (currentPrice <= 0) {
      throw new Error(`Invalid price for opening position: ${currentPrice}`);
    }

    if (this.hasOpenPosition() || this.cash <= 0) {
      return false;
    }

    const allocatedAmount = this.cash * (this.positionSizePercent / 100);
    const feeRate = this.tradeFeePercent / 100;
    const entryFee = allocatedAmount * feeRate;
    const netInvest = allocatedAmount - entryFee;
    const quantity = netInvest / currentPrice;

    this.cash -= allocatedAmount;
    this.currentPosition = {
      quantity,
      entryPrice: currentPrice,
      entrySignal: signal,
      entryCost: allocatedAmount,
      entryFee,
      entryTime: timestamp,
    };

    return true;
  }

  /**
   * Closes the active position, realizes PnL, deducts exit fees, and credits cash.
   */
  closePosition(signal: TradeSignal, currentPrice: number, timestamp: number): Trade | null {
    if (currentPrice <= 0) {
      throw new Error(`Invalid price for closing position: ${currentPrice}`);
    }

    if (!this.currentPosition) {
      return null;
    }

    const pos = this.currentPosition;
    const grossExitValue = pos.quantity * currentPrice;
    const feeRate = this.tradeFeePercent / 100;
    const exitFee = grossExitValue * feeRate;
    const netExitValue = grossExitValue - exitFee;

    const totalFee = pos.entryFee + exitFee;
    const pnl = netExitValue - pos.entryCost;
    const pnlPercent = (pnl / pos.entryCost) * 100;

    this.cash += netExitValue;

    const trade: Trade = {
      entrySignal: pos.entrySignal,
      exitSignal: signal,
      entryPrice: pos.entryPrice,
      exitPrice: currentPrice,
      quantity: pos.quantity,
      pnl,
      pnlPercent,
      fee: totalFee,
      entryTime: pos.entryTime,
      exitTime: timestamp,
      duration: Math.max(0, timestamp - pos.entryTime),
    };

    this.completedTrades.push(trade);
    this.currentPosition = null;

    return trade;
  }

  /**
   * Calculates total net equity (cash + mark-to-market liquidation value of open position).
   */
  getTotalEquity(currentPrice: number): number {
    if (!this.currentPosition) {
      return this.cash;
    }

    const grossExitValue = this.currentPosition.quantity * currentPrice;
    const exitFee = grossExitValue * (this.tradeFeePercent / 100);
    return this.cash + grossExitValue - exitFee;
  }
}

