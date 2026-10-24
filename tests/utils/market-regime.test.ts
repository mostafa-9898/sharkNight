import { createDailyRegimeCalculator } from '../../src/utils/market-regime';

describe('Market Regime (SH0 / SH1)', () => {
  it('instantiates DailyRegimeCalculator and returns bull or bear deterministically', () => {
    const calc = createDailyRegimeCalculator('BTC');
    // Test on a recent timestamp: 2024-01-15 (bull market)
    const bullTs = new Date('2024-01-15T12:00:00Z').getTime();
    const bullRegime = calc.getRegimeAt(bullTs);
    expect(['bull', 'bear']).toContain(bullRegime);

    // Test on 2022-06-15 (bear market)
    const bearTs = new Date('2022-06-15T12:00:00Z').getTime();
    const bearRegime = calc.getRegimeAt(bearTs);
    expect(bearRegime).toBe('bear');
  });

  it('aggregates 1d candles from 1h if 1d file is absent (e.g. SOL)', () => {
    const calc = createDailyRegimeCalculator('SOL');
    const ts = new Date('2023-01-01T12:00:00Z').getTime();
    const regime = calc.getRegimeAt(ts);
    expect(['bull', 'bear']).toContain(regime);
  });
});

