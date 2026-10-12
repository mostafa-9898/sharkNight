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

  describe('Long position accounting', () => {
    it('should open long position and deduct cash and fee correctly', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 1000,
        tradeFeePercent: 0.1, // 0.1% fee
        positionSizePercent: 100,
      });

      // Invest $1000
      // Fee = 1000 * 0.001 = $1
      // Net Invest = $999
      // Price = 100 -> Quantity = 9.99
      const opened = portfolio.openPosition('long', buySignal, 100, 1000);

      expect(opened).toBe(true);
      expect(portfolio.hasOpenPosition()).toBe(true);
      expect(portfolio.getCash()).toBe(0);

      const pos = portfolio.getOpenPosition();
      expect(pos?.side).toBe('long');
      expect(pos?.quantity).toBe(9.99);
      expect(pos?.entryPrice).toBe(100);
      expect(pos?.entryFee).toBe(1);
    });

    it('should close long position with profit, deduct exit fee, and update cash', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 1000,
        tradeFeePercent: 0.1,
        positionSizePercent: 100,
      });

      portfolio.openPosition('long', buySignal, 100, 1000);

      // Quantity = 9.99
      // Exit at 110:
      // Gross = 9.99 * 110 = 1098.9
      // Exit fee = 1098.9 * 0.001 = 1.0989
      // Net exit = 1098.9 - 1.0989 = 1097.8011
      // Total fee = 1 + 1.0989 = 2.0989
      // PnL = 1097.8011 - 1000 = +97.8011
      const trade = portfolio.closePosition(sellSignal, 110, 2000, 'signal');

      expect(trade).not.toBeNull();
      expect(trade?.side).toBe('long');
      expect(trade?.exitReason).toBe('signal');
      expect(trade?.entryPrice).toBe(100);
      expect(trade?.exitPrice).toBe(110);
      expect(trade?.pnl).toBeCloseTo(97.8, 1);
      expect(trade?.duration).toBe(1000);

      expect(portfolio.hasOpenPosition()).toBe(false);
      expect(portfolio.getCash()).toBeCloseTo(1097.8, 1);
      expect(portfolio.getTrades()).toHaveLength(1);
    });

    it('should close long position with loss when price falls', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 1000,
        tradeFeePercent: 0.1,
      });

      portfolio.openPosition('long', buySignal, 100, 1000);
      const trade = portfolio.closePosition(sellSignal, 90, 2000);

      expect(trade?.pnl).toBeLessThan(0);
      expect(portfolio.getCash()).toBeLessThan(1000);
    });
  });

  describe('Short position accounting', () => {
    it('should open short position with collateral and fee allocation', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 1000,
        tradeFeePercent: 0.1,
        positionSizePercent: 100,
      });

      // Invest $1000
      // Fee = 1000 * 0.001 = $1
      // Net Invest = $999
      // Price = 100 -> Quantity = 9.99
      const opened = portfolio.openPosition('short', sellSignal, 100, 1000);

      expect(opened).toBe(true);
      expect(portfolio.hasOpenPosition()).toBe(true);
      expect(portfolio.getCash()).toBe(0);

      const pos = portfolio.getOpenPosition();
      expect(pos?.side).toBe('short');
      expect(pos?.quantity).toBe(9.99);
      expect(pos?.entryPrice).toBe(100);
      expect(pos?.entryFee).toBe(1);
    });

    it('should close short position with profit when price drops', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 1000,
        tradeFeePercent: 0.1,
      });

      portfolio.openPosition('short', sellSignal, 100, 1000);
      // Exit at 90:
      // entryPrice = 100, exitPrice = 90
      // quantity = 9.99
      // grossExitValue = 9.99 * 90 = 899.1
      // exitFee = 899.1 * 0.001 = 0.8991
      // PnL = quantity * (entryPrice - exitPrice) - exitFee
      // PnL = 9.99 * 10 - 0.8991 = 99.9 - 0.8991 = 99.0009
      const trade = portfolio.closePosition(buySignal, 90, 2000, 'signal');

      expect(trade).not.toBeNull();
      expect(trade?.side).toBe('short');
      expect(trade?.exitReason).toBe('signal');
      expect(trade?.pnl).toBeCloseTo(99.0, 1);
      expect(portfolio.getCash()).toBeCloseTo(1000 + trade!.pnl, 4);
    });

    it('should close short position with loss when price rises', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 1000,
        tradeFeePercent: 0.1,
      });

      portfolio.openPosition('short', sellSignal, 100, 1000);
      // Exit at 110:
      // PnL = 9.99 * (100 - 110) - exitFee < 0
      const trade = portfolio.closePosition(buySignal, 110, 2000, 'signal');

      expect(trade?.side).toBe('short');
      expect(trade?.pnl).toBeLessThan(0);
      expect(portfolio.getCash()).toBeLessThan(1000);
      expect(portfolio.getCash()).toBeCloseTo(1000 + trade!.pnl, 4);
    });

    it('should mark short position to market accurately in getTotalEquity', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 1000,
        tradeFeePercent: 0.1,
      });

      portfolio.openPosition('short', sellSignal, 100, 1000);

      // Price drops to 90 -> equity increases
      expect(portfolio.getTotalEquity(90)).toBeGreaterThan(1000);
      // Price rises to 110 -> equity decreases
      expect(portfolio.getTotalEquity(110)).toBeLessThan(1000);
    });
  });

  it('should prevent opening another position when one is already active', () => {
    const portfolio = new VirtualPortfolio({ initialBalance: 1000 });
    portfolio.openPosition('long', buySignal, 100, 1000);

    const secondOpen = portfolio.openPosition('long', buySignal, 105, 1050);
    expect(secondOpen).toBe(false);
  });

  it('should return null when trying to close non-existent position', () => {
    const portfolio = new VirtualPortfolio({ initialBalance: 1000 });
    const trade = portfolio.closePosition(sellSignal, 110, 2000);
    expect(trade).toBeNull();
  });
});
