import * as fs from 'fs';
import * as path from 'path';

describe('Short Entry Timing & Filter Latency Verification (RC5 - H-C, H-D)', () => {
  it('verifies that rc5_timing_data.json exists with valid metrics', () => {
    const jsonPath = path.resolve('docs/review/rc5_timing_data.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(data.dist50Long).toBeDefined();
    expect(data.dist50Short).toBeDefined();
    expect(data.filterMatrix).toBeDefined();

    // Verify distance from extreme symmetry (< 2% difference between median long and short)
    const distDiff = Math.abs(data.dist50Long.median - data.dist50Short.median);
    expect(distDiff).toBeLessThan(2.0);

    // Verify swing latency symmetry
    expect(data.avgHighLatency).toBe(3);
    expect(data.avgLowLatency).toBe(3);

    // Verify early adverse move symmetry
    const mae3Diff = Math.abs(data.mae3RateLong - data.mae3RateShort);
    expect(mae3Diff).toBeLessThan(3.0);
  });
});
