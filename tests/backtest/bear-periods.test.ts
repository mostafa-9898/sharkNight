import * as fs from 'fs';
import * as path from 'path';

describe('AL3: Bear Market Capital Preservation Analysis', () => {
  const jsonPath = path.resolve('docs/review/bear_periods_data.json');
  const mdPath = path.resolve('docs/review/BEAR_PERIODS.md');

  it('verifies that AL3 output files exist and are populated', () => {
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(Array.isArray(data)).toBe(true);
    // 6 markets * 2 modes * 3 periods = 36 records
    expect(data.length).toBe(36);
  });

  it('validates that 2022, 2025-2026 bear, and full period metrics are present', () => {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const periods = ['۲۰۲۲ کامل', '۲۰۲۵-۲۰۲۶ (زیر SMA200 روزانه BTC)', 'کل دوره ۶ ساله'];

    for (const p of periods) {
      const records = data.filter((d: any) => d.period === p);
      expect(records.length).toBe(12); // 6 markets * 2 modes

      for (const rec of records) {
        expect(typeof rec.compoundedReturn).toBe('number');
        expect(typeof rec.maxDD).toBe('number');
        expect(typeof rec.worstMonth).toBe('number');
        expect(typeof rec.worstDay).toBe('number');
        expect(typeof rec.trades).toBe('number');
      }
    }
  });

  it('verifies that Long-Only beats Long-Short on Full Period across 6 primary markets', () => {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const fullRecords = data.filter((d: any) => d.period === 'کل دوره ۶ ساله');

    const loTotalReturn = fullRecords
      .filter((d: any) => d.mode === 'long-only')
      .reduce((sum: number, d: any) => sum + d.compoundedReturn, 0);

    const lsTotalReturn = fullRecords
      .filter((d: any) => d.mode === 'long-short')
      .reduce((sum: number, d: any) => sum + d.compoundedReturn, 0);

    expect(loTotalReturn).toBeGreaterThan(lsTotalReturn);
  });
});
