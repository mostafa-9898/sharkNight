import * as fs from 'fs';
import * as path from 'path';
import { runSimulation } from '../../src/scripts/run-rc3-synthetic';

describe('Zero-Drift Synthetic Data Symmetry (RC3)', () => {
  it('validates that S1 on zero-drift GBM data satisfies RC0 symmetry condition |diff| <= 2 * SE', () => {
    // Fast verification on 20 paths
    const { stats15m } = runSimulation('V1_Full', 20, 2000);
    expect(stats15m.isSymmetric).toBe(true);
    expect(Math.abs(stats15m.meanDiff)).toBeLessThanOrEqual(2 * stats15m.seDiff);
  });

  it('verifies that rc3_synthetic_data.json exists and has valid 200-path results', () => {
    const jsonPath = path.resolve('docs/review/rc3_synthetic_data.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(data.v1).toBeDefined();
    expect(data.v2).toBeDefined();
    expect(data.v3).toBeDefined();

    expect(data.v1.isSymmetric).toBe(true);
    expect(data.v2.isSymmetric).toBe(true);
    expect(data.v3.isSymmetric).toBe(true);
  });
});
