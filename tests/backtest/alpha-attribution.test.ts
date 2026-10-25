import * as fs from 'fs';
import * as path from 'path';

describe('AL2: Alpha Attribution Decomposition (L0 to L5)', () => {
  const jsonPath = path.resolve('docs/review/alpha_attribution_data.json');
  const mdPath = path.resolve('docs/review/ALPHA_ATTRIBUTION.md');

  it('verifies that AL2 artifacts exist and contain all 14 markets', () => {
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(14);

    const expectedMarkets = [
      'BTC 15m',
      'BTC 1h',
      'BTC 4h',
      'ETH 15m',
      'ETH 1h',
      'ETH 4h',
      'SOL 1h',
      'SOL 4h',
      'BNB 1h',
      'BNB 4h',
      'XRP 1h',
      'XRP 4h',
      'ADA 1h',
      'ADA 4h',
    ];

    const actualMarkets = (data as Array<{ market: string }>).map((d) => d.market);
    for (const em of expectedMarkets) {
      expect(actualMarkets).toContain(em);
    }
  });

  it('verifies that each market includes all layers L0 to L5 for both real and detrended datasets', () => {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const layers = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

    for (const item of data) {
      expect(item.real).toBeDefined();
      expect(item.detrended).toBeDefined();

      for (const l of layers) {
        expect(item.real[l]).toBeDefined();
        expect(typeof item.real[l].totalReturn).toBe('number');
        expect(typeof item.real[l].maxDD).toBe('number');
        expect(typeof item.real[l].nullPctTotal).toBe('number');

        expect(item.detrended[l]).toBeDefined();
        expect(typeof item.detrended[l].totalReturn).toBe('number');
        expect(typeof item.detrended[l].maxDD).toBe('number');
        expect(typeof item.detrended[l].nullPctTotal).toBe('number');
      }
    }
  });

  it('verifies that L3 matches S1 baseline return on BTC 15m real data', () => {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const btc15m = (data as Array<{ market: string; real: { L3: { totalReturn: number; trades: number } } }>).find(
      (d) => d.market === 'BTC 15m'
    );
    expect(btc15m).toBeDefined();

    // S1 on BTC 15m produces +37.29% return
    expect(btc15m!.real.L3.totalReturn).toBe(37.29);
    expect(btc15m!.real.L3.trades).toBe(544);
  });

  it('verifies that L4 produces trades in both directions (long and short) across all 14 markets', () => {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    interface MarketAttributionItem {
      market: string;
      real: Record<string, { longTrades: number; shortTrades: number; trades: number }>;
      detrended: Record<string, { longTrades: number; shortTrades: number; trades: number }>;
    }
    const items = data as MarketAttributionItem[];

    for (const item of items) {
      expect(item.real.L4.longTrades).toBeGreaterThan(0);
      expect(item.real.L4.shortTrades).toBeGreaterThan(0);
      expect(item.real.L4.trades).toBe(item.real.L4.longTrades + item.real.L4.shortTrades);

      expect(item.detrended.L4.longTrades).toBeGreaterThan(0);
      expect(item.detrended.L4.shortTrades).toBeGreaterThan(0);
      expect(item.detrended.L4.trades).toBe(item.detrended.L4.longTrades + item.detrended.L4.shortTrades);
    }
  });
});
