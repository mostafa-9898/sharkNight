import fs from 'fs';
import path from 'path';

describe('RC6: Exit Replay & MFE Capture Truncation Analysis (H-E)', () => {
  const jsonPath = path.resolve(process.cwd(), 'docs/review/rc6_exit_data.json');
  const mdPath = path.resolve(process.cwd(), 'docs/review/SHORT_EXIT.md');

  it('verifies that RC6 output files exist and are populated', () => {
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(json).toBeDefined();
    expect(json.baseline_trailing).toBeDefined();
    expect(json.baseline_trailing.long.tradeCount).toBe(2909);
    expect(json.baseline_trailing.short.tradeCount).toBe(2526);
  });

  it('validates that 5 exit mechanisms were replayed for both Long and Short', () => {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const expectedKeys = ['baseline_trailing', 'fixed_stop_3', 'fixed_stop_5', 'atr_trailing_2_5', 'time_stop_24'];
    
    for (const key of expectedKeys) {
      expect(json[key]).toBeDefined();
      expect(json[key].long).toBeDefined();
      expect(json[key].short).toBeDefined();
      expect(json[key].long.tradeCount).toBe(2909);
      expect(json[key].short.tradeCount).toBe(2526);
    }
  });

  it('confirms that Short baseline PF is below 1.0 while Long baseline PF is above 1.5', () => {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const baseline = json.baseline_trailing;
    
    expect(baseline.short.profitFactor).toBeLessThan(1.0);
    expect(baseline.long.profitFactor).toBeGreaterThan(1.5);
  });

  it('confirms that no symmetric exit variant turns shorts profitable on raw historical data', () => {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const expectedKeys = ['baseline_trailing', 'fixed_stop_3', 'fixed_stop_5', 'atr_trailing_2_5', 'time_stop_24'];
    
    for (const key of expectedKeys) {
      // All short total returns on raw data should be negative
      expect(json[key].short.totalPnlPercent).toBeLessThan(0);
    }
  });
});
