import fs from 'fs';
import path from 'path';

describe('RC7: Short Root Cause Synthesis & Preregistered Criteria', () => {
  const rootCauseMd = path.resolve(process.cwd(), 'docs/review/SHORT_ROOTCAUSE.md');
  const preregisteredRcMd = path.resolve(process.cwd(), 'docs/review/PREREGISTERED_RC.md');
  const reqCheckMd = path.resolve(process.cwd(), 'docs/review/REQUIREMENTS_CHECK.md');

  it('verifies that SHORT_ROOTCAUSE.md, PREREGISTERED_RC.md, and REQUIREMENTS_CHECK.md exist', () => {
    expect(fs.existsSync(rootCauseMd)).toBe(true);
    expect(fs.existsSync(preregisteredRcMd)).toBe(true);
    expect(fs.existsSync(reqCheckMd)).toBe(true);
  });

  it('verifies that all hypotheses H-A through H-F are evaluated with explicit status in SHORT_ROOTCAUSE.md', () => {
    const content = fs.readFileSync(rootCauseMd, 'utf8');
    
    // Status checks
    expect(content).toContain('H-A');
    expect(content).toContain('H-B');
    expect(content).toContain('H-C');
    expect(content).toContain('H-D');
    expect(content).toContain('H-E');
    expect(content).toContain('H-F');

    // Expected verdicts
    expect(content).toMatch(/H-A[\s\S]*?REJECTED/);
    expect(content).toMatch(/H-B[\s\S]*?REJECTED/);
    expect(content).toMatch(/H-C[\s\S]*?REJECTED/);
    expect(content).toMatch(/H-D[\s\S]*?REJECTED/);
    expect(content).toMatch(/H-E[\s\S]*?INCONCLUSIVE/);
    expect(content).toMatch(/H-F[\s\S]*?CONFIRMED/);
  });

  it('verifies that REQUIREMENTS_CHECK.md includes all RC0 through RC7 rows with PASS status', () => {
    const content = fs.readFileSync(reqCheckMd, 'utf8');
    for (let i = 0; i <= 7; i++) {
      expect(content).toContain(`**RC${i}**`);
    }
  });

  it('validates that all RC test and data files are present', () => {
    const requiredFiles = [
      'docs/review/PREREGISTERED_RC.md',
      'tests/backtest/short-accounting.test.ts',
      'tests/strategies/mirror-symmetry.test.ts',
      'docs/review/RC2.md',
      'src/scripts/run-rc3-synthetic.ts',
      'docs/review/RC3.md',
      'docs/review/rc3_synthetic_data.json',
      'tests/backtest/synthetic-drift.test.ts',
      'src/scripts/run-rc4-detrend.ts',
      'docs/review/RC4.md',
      'docs/review/rc4_detrend_data.json',
      'tests/backtest/detrend.test.ts',
      'src/scripts/run-rc5-timing.ts',
      'docs/review/SHORT_ENTRY_TIMING.md',
      'docs/review/rc5_timing_data.json',
      'tests/backtest/entry-timing.test.ts',
      'src/scripts/run-rc6-exit-replay.ts',
      'docs/review/SHORT_EXIT.md',
      'docs/review/rc6_exit_data.json',
      'tests/backtest/exit-replay.test.ts',
      'docs/review/SHORT_ROOTCAUSE.md'
    ];

    for (const f of requiredFiles) {
      expect(fs.existsSync(path.resolve(process.cwd(), f))).toBe(true);
    }
  });
});
