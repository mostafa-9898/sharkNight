import fs from 'fs';
import path from 'path';
import type { PuEvaluationOutput } from '@/scripts/run-pu-entryfill';

describe('PU2 Backtest Execution Sensitivity Evaluation', () => {
  const jsonPath = path.resolve('docs/review/pu_entryfill_data.json');
  const mdPath = path.resolve('docs/review/PU_ENTRYFILL.md');

  it('validates generated JSON structure and market completeness', () => {
    if (!fs.existsSync(jsonPath)) {
      console.warn('pu_entryfill_data.json not found yet; skipping if running before script');
      return;
    }

    const data: PuEvaluationOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(data).toHaveProperty('strategies');
    expect(data.strategies).toHaveProperty('c1l');
    expect(data.strategies).toHaveProperty('f3l');
    expect(data.strategies).toHaveProperty('f0l');

    for (const stratKey of ['c1l', 'f3l', 'f0l'] as const) {
      const s = data.strategies[stratKey];
      expect(s.markets.length).toBe(14);

      // Verify each market has non-empty valid numbers
      for (const m of s.markets) {
        expect(Number.isFinite(m.close.totalReturn)).toBe(true);
        expect(Number.isFinite(m.nextOpen.totalReturn)).toBe(true);
        expect(Number.isFinite(m.close.maxDD)).toBe(true);
        expect(Number.isFinite(m.nextOpen.maxDD)).toBe(true);
        expect(Number.isFinite(m.returnDropPercent)).toBe(true);
        expect(Number.isFinite(m.retDdDropPercent)).toBe(true);
      }

      // Verify timeframe groupings
      expect(Number.isFinite(s.byTimeframe.tf15m.meanReturnDrop)).toBe(true);
      expect(Number.isFinite(s.byTimeframe.tf1h.meanReturnDrop)).toBe(true);
      expect(Number.isFinite(s.byTimeframe.tf4h.meanReturnDrop)).toBe(true);

      // Verify verdict matches criteria
      const expectedSensitive = s.allMarkets.medianReturnDrop > 20 || s.allMarkets.medianRetDdDrop > 15;
      const expectedVerdict = expectedSensitive
        ? 'حساس به اجرا (Execution Sensitive)'
        : 'مقاوم (Robust)';
      expect(s.verdict).toBe(expectedVerdict);
    }
  });

  it('validates that PU_ENTRYFILL.md markdown report exists and contains summary tables', () => {
    if (!fs.existsSync(mdPath)) {
      return;
    }
    const md = fs.readFileSync(mdPath, 'utf-8');
    expect(md).toContain('# گزارش تجربی حساسیت به نحوهٔ اجرای ورود (PU_ENTRYFILL.md)');
    expect(md).toContain('C1L (Long-Only Extra-Trigger)');
    expect(md).toContain('F3L (Long-Only Confirm)');
    expect(md).toContain('F0L (Long-Only Off)');
    expect(md).toContain('15m');
    expect(md).toContain('1h');
    expect(md).toContain('4h');
  });
});
