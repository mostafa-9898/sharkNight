import { VirtualPortfolio } from '@/backtest/portfolio';
import type { TradeSignal } from '@/data/models';

describe('VirtualPortfolio', () => {
  const buySignal: TradeSignal = {
    action: 'BUY',
    timestamp: 1000,
    price: 100,
    reason: 'Test Buy',
  };

  const sellSignal: TradeSignal = {
    action: 'SELL',
    timestamp: 2000,
    price: 110,
    reason: 'Test Sell',
  };

  it('should initialize with correct cash and parameters', () => {
    const portfolio = new VirtualPortfolio({
      initialBalance: 10000,
      tradeFeePercent: 0.1,
      positionSizePercent: 100,
    });

    expect(portfolio.getCash()).toBe(10000);
    expect(portfolio.hasOpenPosition()).toBe(false);
    expect(portfolio.getTrades()).toEqual([]);
  });

  it('should throw error when initialBalance is non-positive', () => {
    expect(() => new VirtualPortfolio({ initialBalance: 0 })).toThrow('Initial balance must be positive');
    expect(() => new VirtualPortfolio({ initialBalance: -100 })).toThrow('Initial balance must be positive');
  });

  it('should open position and deduct cash and fee correctly', () => {
    const portfolio = new VirtualPortfolio({
      initialBalance: 1000,
      tradeFeePercent: 0.1, // 0.1% fee
      positionSizePercent: 100,
    });

    // Invest $1000
    // Fee = 1000 * 0.001 = $1
    // Net Invest = $999
    // Price = 100 -> Quantity = 9.99
    const opened = portfolio.openPosition(buySignal, 100, 1000);

    expect(opened).toBe(true);
    expect(portfolio.hasOpenPosition()).toBe(true);
    expect(portfolio.getCash()).toBe(0);

    const pos = portfolio.getOpenPosition();
    expect(pos?.quantity).toBe(9.99);
    expect(pos?.entryPrice).toBe(100);
    expect(pos?.entryFee).toBe(1);
  });

  it('should prevent opening another position when one is already active', () => {
    const portfolio = new VirtualPortfolio({ initialBalance: 1000 });
    portfolio.openPosition(buySignal, 100, 1000);

    const secondOpen = portfolio.openPosition(buySignal, 105, 1050);
    expect(secondOpen).toBe(false);
  });

  it('should close position, realize profit, deduct exit fee, and update cash', () => {
    const portfolio = new VirtualPortfolio({
      initialBalance: 1000,
      tradeFeePercent: 0.1,
      positionSizePercent: 100,
    });

    portfolio.openPosition(buySignal, 100, 1000);

    // Quantity = 9.99
    // Exit at 110:
    // Gross = 9.99 * 110 = 1098.9
    // Exit fee = 1098.9 * 0.001 = 1.0989
    // Net exit = 1098.9 - 1.0989 = 1097.8011
    // Total fee = 1 + 1.0989 = 2.0989
    // PnL = 1097.8011 - 1000 = +97.8011
    const trade = portfolio.closePosition(sellSignal, 110, 2000);

    expect(trade).not.toBeNull();
    expect(trade?.entryPrice).toBe(100);
    expect(trade?.exitPrice).toBe(110);
    expect(trade?.pnl).toBeCloseTo(97.8, 1);
    expect(trade?.duration).toBe(1000);

    expect(portfolio.hasOpenPosition()).toBe(false);
    expect(portfolio.getCash()).toBeCloseTo(1097.8, 1);
    expect(portfolio.getTrades()).toHaveLength(1);
  });

  it('should return null when trying to close non-existent position', () => {
    const portfolio = new VirtualPortfolio({ initialBalance: 1000 });
    const trade = portfolio.closePosition(sellSignal, 110, 2000);
    expect(trade).toBeNull();
  });

  it('should calculate mark-to-market equity during open position', () => {
    const portfolio = new VirtualPortfolio({
      initialBalance: 1000,
      tradeFeePercent: 0.1,
    });

    expect(portfolio.getTotalEquity(100)).toBe(1000);

    portfolio.openPosition(buySignal, 100, 1000);
    // When price rises to 120, equity should reflect liquidation value
    const equityAt120 = portfolio.getTotalEquity(120);
    expect(equityAt120).toBeGreaterThan(1000);
  });
});

