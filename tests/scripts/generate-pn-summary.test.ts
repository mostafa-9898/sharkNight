import {
  formatConfigSummary,
  renderConfigSection,
} from '../../src/scripts/generate-pn-summary';
import {
  C1_CONFIG,
  F3_CONFIG,
  F0_CONFIG,
  C1L_CONFIG,
  PnFullConfig,
} from '../../src/scripts/run-pn3-evaluation';

describe('PY0: generate-pn-summary dynamic config formatting', () => {
  it('should reflect actual values of imported C1_CONFIG', () => {
    const formatted = formatConfigSummary('C1', C1_CONFIG);
    expect(formatted).toContain(`fisherMode: '${C1_CONFIG.fisherMode}'`);
    expect(formatted).toContain(`fisherKind: '${C1_CONFIG.fisherKind}'`);
    expect(formatted).toContain(`kijunSlopeFilter: ${C1_CONFIG.kijunSlopeFilter}`);
    expect(formatted).toContain(`structureFilter: ${C1_CONFIG.structureFilter}`);
    expect(formatted).toContain(`stoch: 14/3/${C1_CONFIG.stochSmooth}`);
    expect(formatted).toContain(`tradeMode: '${C1_CONFIG.tradeMode}'`);
    expect(formatted).toContain(`step: ${C1_CONFIG.trailingStop.stepPercent}%`);
  });

  it('should dynamically update when config properties change', () => {
    const customConfig: PnFullConfig = {
      ...C1_CONFIG,
      fisherMode: 'replace-stoch',
      stochSmooth: 9,
      stochOversold: 15,
      stochOverbought: 85,
      kijunSlopeFilter: false,
      tradeMode: 'long-only',
      trailingStop: {
        ...C1_CONFIG.trailingStop,
        initialStopPercent: 7.5,
        stepPercent: 2.25,
      },
    };

    const formatted = formatConfigSummary('Custom', customConfig);
    expect(formatted).toContain("fisherMode: 'replace-stoch'");
    expect(formatted).toContain('stoch: 14/3/9 (15/85)');
    expect(formatted).toContain('kijunSlopeFilter: false');
    expect(formatted).toContain("tradeMode: 'long-only'");
    expect(formatted).toContain('initialStop: 7.5%');
    expect(formatted).toContain('step: 2.25%');
  });

  it('should render all configs dynamically in renderConfigSection', () => {
    const lines = renderConfigSection({
      C1: C1_CONFIG,
      F3: F3_CONFIG,
      F0: F0_CONFIG,
      C1L: C1L_CONFIG,
    });

    expect(lines[0]).toContain('پیکربندی‌ها');
    expect(lines.find((l) => l.startsWith('- **C1**:'))).toContain(`fisherMode: '${C1_CONFIG.fisherMode}'`);
    expect(lines.find((l) => l.startsWith('- **F3**:'))).toContain("fisherMode: 'confirm'");
    expect(lines.find((l) => l.startsWith('- **F0**:'))).toContain("fisherMode: 'off'");
    expect(lines.find((l) => l.startsWith('- **C1L**:'))).toContain("tradeMode: 'long-only'");
  });
});

