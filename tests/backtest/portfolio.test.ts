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

    it('should close short position with profit when price drops (10% drop -> +980.01 on 10,000)', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 10000,
        tradeFeePercent: 0.1,
      });

      portfolio.openPosition('short', sellSignal, 100, 1000);
      // Entry: allocated 10000, fee 10, net 9990, qty = 99.9
      // Exit at 90:
      // exitFee = 99.9 * 90 * 0.001 = 8.991
      // PnL = 99.9 * (100 - 90) - 8.991 - 10 = 999 - 18.991 = 980.009 -> +980.01
      const trade = portfolio.closePosition(buySignal, 90, 2000, 'signal');

      expect(trade).not.toBeNull();
      expect(trade?.side).toBe('short');
      expect(trade?.exitReason).toBe('signal');
      expect(trade?.pnl).toBeCloseTo(980.01, 2);
      expect(portfolio.getCash()).toBeCloseTo(10000 + trade!.pnl, 4);
    });

    it('should close short position with loss when price rises (10% rise -> -1019.99 on 10,000)', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 10000,
        tradeFeePercent: 0.1,
      });

      portfolio.openPosition('short', sellSignal, 100, 1000);
      // Exit at 110:
      // exitFee = 99.9 * 110 * 0.001 = 10.989
      // PnL = 99.9 * (100 - 110) - 10.989 - 10 = -999 - 20.989 = -1019.989 -> -1019.99
      const trade = portfolio.closePosition(buySignal, 110, 2000, 'signal');

      expect(trade?.side).toBe('short');
      expect(trade?.pnl).toBeCloseTo(-1019.99, 2);
      expect(portfolio.getCash()).toBeLessThan(10000);
      expect(portfolio.getCash()).toBeCloseTo(10000 + trade!.pnl, 4);
    });

    it('should result in identical -19.99 fee loss on flat price round trip for both long and short', () => {
      const longPortfolio = new VirtualPortfolio({
        initialBalance: 10000,
        tradeFeePercent: 0.1,
      });
      longPortfolio.openPosition('long', buySignal, 100, 1000);
      const longTrade = longPortfolio.closePosition(sellSignal, 100, 2000, 'signal');

      const shortPortfolio = new VirtualPortfolio({
        initialBalance: 10000,
        tradeFeePercent: 0.1,
      });
      shortPortfolio.openPosition('short', sellSignal, 100, 1000);
      const shortTrade = shortPortfolio.closePosition(buySignal, 100, 2000, 'signal');

      expect(longTrade?.pnl).toBeCloseTo(-19.99, 2);
      expect(shortTrade?.pnl).toBeCloseTo(-19.99, 2);
      expect(longPortfolio.getCash()).toBeCloseTo(9980.01, 2);
      expect(shortPortfolio.getCash()).toBeCloseTo(9980.01, 2);
    });

    it('should mark short position to market accurately in getTotalEquity with continuity at close', () => {
      const portfolio = new VirtualPortfolio({
        initialBalance: 10000,
        tradeFeePercent: 0.1,
      });

      portfolio.openPosition('short', sellSignal, 100, 1000);

      // Price drops to 90 -> equity increases to ~10980.01
      expect(portfolio.getTotalEquity(90)).toBeCloseTo(10980.01, 2);
      // Price rises to 110 -> equity decreases to ~8980.01
      expect(portfolio.getTotalEquity(110)).toBeCloseTo(8980.01, 2);

      // Equity right before closing at 90 matches cash right after closing at 90
      const equityBeforeClose = portfolio.getTotalEquity(90);
      portfolio.closePosition(buySignal, 90, 2000, 'signal');
      expect(portfolio.getCash()).toBeCloseTo(equityBeforeClose, 4);
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
