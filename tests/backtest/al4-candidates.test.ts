import * as fs from 'fs';
import * as path from 'path';

describe('AL4: Edge Candidates Evaluation (A1 to A6)', () => {
  const jsonPath = path.resolve('docs/review/al4_candidates_data.json');
  const mdPath = path.resolve('docs/review/AL4_CANDIDATES.md');

  it('verifies that AL4 artifacts exist and contain 14 markets and 6 candidates', () => {
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(data.metadata.marketsCount).toBe(14);
    expect(data.summaries.length).toBe(6);
    expect(data.markets.length).toBe(14);

    const candidateKeys = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
    const summaryKeys = (data.summaries as Array<{ name: string }>).map((s) => s.name);
    for (const ck of candidateKeys) {
      expect(summaryKeys).toContain(ck);
    }
  });

  it('verifies that all candidates were evaluated on criteria الف, ب, ج, د', () => {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    for (const s of data.summaries as Array<{
      criteriaA: boolean;
      criteriaB: boolean;
      criteriaC: boolean;
      criteriaD: boolean;
      overallPassed: boolean;
      realTotalReturnAvg: number;
      realMaxDDAvg: number;
      deltaDetrendedTotalAvg: number;
    }>) {
      expect(typeof s.criteriaA).toBe('boolean');
      expect(typeof s.criteriaB).toBe('boolean');
      expect(typeof s.criteriaC).toBe('boolean');
      expect(typeof s.criteriaD).toBe('boolean');
      expect(typeof s.overallPassed).toBe('boolean');
      expect(typeof s.realTotalReturnAvg).toBe('number');
      expect(typeof s.realMaxDDAvg).toBe('number');
      expect(typeof s.deltaDetrendedTotalAvg).toBe('number');
    }
  });

  it('verifies that no candidate passed all 4 criteria unconditionally, preventing overfitting', () => {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const anyPassed = (data.summaries as Array<{ overallPassed: boolean }>).some((s) => s.overallPassed === true);
    // As observed empirically, no candidate satisfied all 4 preregistered constraints simultaneously
    expect(anyPassed).toBe(false);
  });
});
