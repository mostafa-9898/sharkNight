import type { TradeSignal } from '../data/models';
import type { Trade, TradeSide, ExitReason, EntryDiagnostics, StopUpdateEvent } from './types';
import { roundTo } from '../utils/math';

export interface ExtraTradeInfo {
  maxFavorablePercent?: number;
  maxAdversePercent?: number;
  stopPrice?: number;
  initialStopPrice?: number;
  initialStopPercent?: number;
  stopHistory?: StopUpdateEvent[];
  ratchetSteps?: number;
  entryDiagnostics?: EntryDiagnostics;
}

export interface PortfolioOptions {
  initialBalance: number;
  tradeFeePercent?: number;     // e.g. 0.1 for 0.1%
  positionSizePercent?: number; // e.g. 100 for 100% of cash
}

export interface OpenPosition {
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  entrySignal: TradeSignal;
  entryCost: number;
  entryFee: number;
  entryTime: number;
}

/**
 * Virtual portfolio managing cash balance, active positions, and completed trade logs.
 *
 * Short Accounting Model & Assumptions / Limitations:
 * - 1x unleveraged short selling model: allocates positionSizePercent of available cash as collateral.
 * - Entry fee: allocatedAmount * feeRate.
 * - Quantity shorted: (allocatedAmount - entryFee) / entryPrice.
 * - On position close, PnL = quantity * (entryPrice - exitPrice) - exitFee.
 * - Cash returned on short close = entryCost + PnL.
 * - Mark-to-market equity during open short = cash + entryCost + [quantity * (entryPrice - currentPrice) - exitFee].
 * - Limitations:
 *   1. No leverage: margin multiplier is strictly 1x.
 *   2. No funding / borrow fees: positions incur no overnight or perpetual funding rate cost.
 *   3. No liquidation / margin calls: positions are not liquidated intrabar if price increases,
 *      relying on engine-level stop loss or strategy signals to close.
 */
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
    this.positionSizePercent = Math.min(100, Math.max(0.0001, options.positionSizePercent ?? 100));
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
   * Opens a new long or short position if no position is currently open and cash is available.
   */
  openPosition(
    side: TradeSide,
    signal: TradeSignal,
    currentPrice: number,
    timestamp: number,
    sizePercentOverride?: number
  ): boolean {
    if (currentPrice <= 0) {
      throw new Error(`Invalid price for opening position: ${currentPrice}`);
    }

    if (this.hasOpenPosition() || this.cash <= 0) {
      return false;
    }

    const effectiveSize =
      sizePercentOverride !== undefined
        ? Math.min(100, Math.max(0.0001, sizePercentOverride))
        : this.positionSizePercent;

    const allocatedAmount = this.cash * (effectiveSize / 100);
    const feeRate = this.tradeFeePercent / 100;
    const entryFee = allocatedAmount * feeRate;
    const netInvest = allocatedAmount - entryFee;
    const quantity = netInvest / currentPrice;

    this.cash -= allocatedAmount;
    this.currentPosition = {
      side,
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
  closePosition(
    signal: TradeSignal,
    currentPrice: number,
    timestamp: number,
    exitReason: ExitReason = 'signal',
    extra?: ExtraTradeInfo
  ): Trade | null {
    if (currentPrice <= 0) {
      throw new Error(`Invalid price for closing position: ${currentPrice}`);
    }

    if (!this.currentPosition) {
      return null;
    }

    const pos = this.currentPosition;
    const feeRate = this.tradeFeePercent / 100;
    const grossExitValue = pos.quantity * currentPrice;
    const exitFee = grossExitValue * feeRate;
    const totalFee = pos.entryFee + exitFee;

    let pnl: number;
    let netExitValue: number;

    if (pos.side === 'long') {
      netExitValue = grossExitValue - exitFee;
      pnl = netExitValue - pos.entryCost;
    } else {
      // Short: PnL = quantity * (entryPrice - exitPrice) - exitFee - entryFee
      pnl = pos.quantity * (pos.entryPrice - currentPrice) - exitFee - pos.entryFee;
      netExitValue = pos.entryCost + pnl;
    }

    const pnlPercent = (pnl / pos.entryCost) * 100;
    this.cash += netExitValue;

    const defaultMfe =
      pos.side === 'long'
        ? Math.max(0, ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100)
        : Math.max(0, ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100);
    const defaultMae =
      pos.side === 'long'
        ? Math.max(0, ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100)
        : Math.max(0, ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100);

    const trade: Trade = {
      side: pos.side,
      exitReason,
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
      maxFavorablePercent: roundTo(extra?.maxFavorablePercent ?? defaultMfe, 2),
      maxAdversePercent: roundTo(extra?.maxAdversePercent ?? defaultMae, 2),
      stopPrice: extra?.stopPrice !== undefined ? roundTo(extra.stopPrice, 4) : undefined,
      initialStopPrice: extra?.initialStopPrice !== undefined ? roundTo(extra.initialStopPrice, 4) : undefined,
      initialStopPercent: extra?.initialStopPercent,
      stopHistory: extra?.stopHistory ? [...extra.stopHistory] : undefined,
      ratchetSteps: extra?.ratchetSteps,
      entryDiagnostics: extra?.entryDiagnostics,
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

    const feeRate = this.tradeFeePercent / 100;
    const grossExitValue = this.currentPosition.quantity * currentPrice;
    const exitFee = grossExitValue * feeRate;

    if (this.currentPosition.side === 'long') {
      return this.cash + grossExitValue - exitFee;
    } else {
      const unrealizedPnl =
        this.currentPosition.quantity * (this.currentPosition.entryPrice - currentPrice) -
        exitFee -
        this.currentPosition.entryFee;
      return this.cash + this.currentPosition.entryCost + unrealizedPnl;
    }
  }
}
