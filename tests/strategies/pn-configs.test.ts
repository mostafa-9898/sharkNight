import {
  C1_CONFIG,
  F3_CONFIG,
  F0_CONFIG,
  C1L_CONFIG,
  type PnFullConfig,
} from '../../src/scripts/run-pn3-evaluation';
import type { MultiTimeframeStrategyConfig } from '../../src/strategies/multi-timeframe-strategy';
import * as defaults from '../../src/config/defaults';

describe('PX0: PN3 Strategy and Engine Configs Verification', () => {
  // All allowed keys from MultiTimeframeStrategyConfig (strategy options)
  const ALLOWED_STRATEGY_KEYS = new Set<string>([
    'htfMode',
    'entryMode',
    'kijunSlopeFilter',
    'structureFilter',
    'shortEntryFilter',
    'attributionLayer',
    'edgeCandidate',
    'a6Components',
    'regimeVariant',
    'htf4hCandles',
    'htf1hCandles',
    'daily1dCandles',
    'dailyRegimeCalculator',
    'ltfIntervalMs',
    'fisherMode',
    'fisherKind',
    'fisherGate',
    'tenkan',
    'kijun',
    'senkouB',
    'displacement',
    'rsiPeriod',
    'stochKPeriod',
    'stochDPeriod',
    'stochSmooth',
    'stochOversold',
    'stochOverbought',
    'initialStopPercent',
    'useTdrStop',
    'tdrMultiplier',
  ]);

  // All allowed keys from defaults / engine backtest options
  const ALLOWED_ENGINE_KEYS = new Set<string>([
    'tradeMode',
    'positionSizePercent',
    'maxOpenPositions',
    'maxTotalExposurePercent',
    'allowOppositePositions',
    'tradeFeePercent',
    'slippagePercent',
    'trailingStop',
    'initialBalance',
    'exitMode',
    'stopCheckMode',
    'trailingStopEnabled',
    'trailingMode',
    'minBarsBetweenEntries',
    'initialStopPercent',
  ]);

  const ALLOWED_ALL_KEYS = new Set<string>([...ALLOWED_STRATEGY_KEYS, ...ALLOWED_ENGINE_KEYS]);

  const configs: Record<string, PnFullConfig> = {
    C1: C1_CONFIG,
    F3: F3_CONFIG,
    F0: F0_CONFIG,
    C1L: C1L_CONFIG,
  };

  for (const [name, cfg] of Object.entries(configs)) {
    describe(`Config ${name}`, () => {
      it('contains only known keys from MultiTimeframeStrategyConfig and defaults.ts', () => {
        const keys = Object.keys(cfg);
        const unknownKeys = keys.filter((k) => !ALLOWED_ALL_KEYS.has(k));
        expect(unknownKeys).toEqual([]);
      });

      it('has exact parameter naming matching code and preregistration', () => {
        // No deprecated/typo names
        expect(cfg).not.toHaveProperty('filterKijunSlope');
        expect(cfg).not.toHaveProperty('filterStructure');
        expect(cfg).not.toHaveProperty('fisher_mode');

        // Parameter checks
        expect(cfg.kijunSlopeFilter).toBe(true);
        expect(cfg.structureFilter).toBe(true);
        expect(cfg.stochSmooth).toBe(3);
        expect(cfg.stochOversold).toBe(30);
        expect(cfg.stochOverbought).toBe(70);
        expect(cfg.fisherKind).toBe('fisher');
        expect(cfg.fisherGate).toBe('none');
        expect(cfg.allowOppositePositions).toBe(true);

        // Trailing stop object
        expect(cfg.trailingStop).toEqual({
          initialStopPercent: 5,
          stepPercent: 3,
          raisePercent: 1.5,
          mode: 'stepped',
        });
      });
    });
  }

  it('validates fisherMode enum ∈ {"off", "extra-trigger", "replace-stoch", "confirm"}', () => {
    const validModes = new Set(['off', 'extra-trigger', 'replace-stoch', 'confirm']);

    expect(validModes.has(C1_CONFIG.fisherMode)).toBe(true);
    expect(C1_CONFIG.fisherMode).toBe('extra-trigger');

    expect(validModes.has(F3_CONFIG.fisherMode)).toBe(true);
    expect(F3_CONFIG.fisherMode).toBe('confirm');

    expect(validModes.has(F0_CONFIG.fisherMode)).toBe(true);
    expect(F0_CONFIG.fisherMode).toBe('off'); // Note: 'off', NOT 'none'

    expect(validModes.has(C1L_CONFIG.fisherMode)).toBe(true);
    expect(C1L_CONFIG.fisherMode).toBe('extra-trigger');
    expect(C1L_CONFIG.tradeMode).toBe('long-only');
  });

  it('fails if an unknown or obsolete key is present in a configuration', () => {
    const badConfig: Record<string, unknown> = {
      ...C1_CONFIG,
      filterKijunSlope: true, // obsolete typo key
      unknownCustomParam: 123, // unknown key
    };

    const unknownKeys = Object.keys(badConfig).filter((k) => !ALLOWED_ALL_KEYS.has(k));
    expect(unknownKeys).toContain('filterKijunSlope');
    expect(unknownKeys).toContain('unknownCustomParam');
  });
});
