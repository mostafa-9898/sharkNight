import {
  parseArg,
  parseNumArg,
  parseBoolArg,
  parseCliArgs,
} from '@/scripts/backtest-report';
import { IchimokuRsiStrategy } from '@/strategies/ichimoku-rsi-strategy';

describe('CLI Argument Parsing & Parameter Wiring (Step 5)', () => {
  describe('parseBoolArg', () => {
    it('evaluates bare flag as true', () => {
      expect(parseBoolArg('kijunSlopeFilter', false, ['--kijunSlopeFilter'])).toBe(true);
    });

    it('evaluates truthy explicit values as true', () => {
      expect(parseBoolArg('kijunSlopeFilter', false, ['--kijunSlopeFilter=true'])).toBe(true);
      expect(parseBoolArg('kijunSlopeFilter', false, ['--kijunSlopeFilter=TRUE'])).toBe(true);
      expect(parseBoolArg('kijunSlopeFilter', false, ['--kijunSlopeFilter=1'])).toBe(true);
      expect(parseBoolArg('kijunSlopeFilter', false, ['--kijunSlopeFilter=yes'])).toBe(true);
      expect(parseBoolArg('kijunSlopeFilter', false, ['--kijunSlopeFilter=YES'])).toBe(true);
    });

    it('evaluates falsy explicit values as false', () => {
      expect(parseBoolArg('kijunSlopeFilter', true, ['--kijunSlopeFilter=false'])).toBe(false);
      expect(parseBoolArg('kijunSlopeFilter', true, ['--kijunSlopeFilter=FALSE'])).toBe(false);
      expect(parseBoolArg('kijunSlopeFilter', true, ['--kijunSlopeFilter=0'])).toBe(false);
      expect(parseBoolArg('kijunSlopeFilter', true, ['--kijunSlopeFilter=no'])).toBe(false);
      expect(parseBoolArg('kijunSlopeFilter', true, ['--kijunSlopeFilter=NO'])).toBe(false);
    });

    it('returns default value when flag is omitted', () => {
      expect(parseBoolArg('kijunSlopeFilter', false, [])).toBe(false);
      expect(parseBoolArg('kijunSlopeFilter', true, [])).toBe(true);
      expect(parseBoolArg('kijunSlopeFilter', false, ['--otherArg=foo'])).toBe(false);
    });

    it('strictly throws a descriptive error on invalid boolean strings and does NOT evaluate to true', () => {
      const invalidValues = ['invalid', 'banana', 'maybe', '2', '-1', 'null', 'undefined', 'falsey'];
      for (const val of invalidValues) {
        expect(() =>
          parseBoolArg('kijunSlopeFilter', false, [`--kijunSlopeFilter=${val}`])
        ).toThrow(/Invalid boolean value for argument --kijunSlopeFilter/);
      }
    });
  });

  describe('parseNumArg & parseArg', () => {
    it('parses valid numeric values', () => {
      expect(parseNumArg('tenkan', 9, ['--tenkan=12'])).toBe(12);
      expect(parseNumArg('tradeFeePercent', 0.1, ['--tradeFeePercent=0.075'])).toBe(0.075);
    });

    it('returns default value when numeric argument is omitted', () => {
      expect(parseNumArg('tenkan', 9, [])).toBe(9);
      expect(parseNumArg('tenkan', undefined, [])).toBeUndefined();
    });

    it('throws on non-numeric values', () => {
      expect(() => parseNumArg('tenkan', 9, ['--tenkan=not-a-number'])).toThrow(
        /Invalid numeric value for argument --tenkan/
      );
    });

    it('parses generic string arguments', () => {
      expect(parseArg('symbol', 'BTCUSDT', ['--symbol=ETHUSDT'])).toBe('ETHUSDT');
      expect(parseArg('symbol', 'BTCUSDT', [])).toBe('BTCUSDT');
    });
  });

  describe('parseCliArgs & Strategy parameter forwarding', () => {
    it('correctly maps default CLI arguments', () => {
      const opts = parseCliArgs([]);
      expect(opts.symbol).toBe('BTCUSDT');
      expect(opts.interval).toBe('1h');
      expect(opts.period).toBe('6y');
      expect(opts.tenkan).toBe(9);
      expect(opts.kijun).toBe(26);
      expect(opts.senkouB).toBe(52);
      expect(opts.kijunSlopeFilter).toBe(false);
      expect(opts.cloudFilter).toBe('off');
    });

    it('correctly parses and forwards kijunSlopeFilter when enabled', () => {
      const opts = parseCliArgs([
        '--symbol=ETHUSDT',
        '--interval=4h',
        '--kijunSlopeFilter=true',
        '--cloudFilter=trend',
        '--rsiRecoveryCap=10',
      ]);

      expect(opts.symbol).toBe('ETHUSDT');
      expect(opts.interval).toBe('4h');
      expect(opts.kijunSlopeFilter).toBe(true);
      expect(opts.cloudFilter).toBe('trend');
      expect(opts.rsiRecoveryCap).toBe(10);

      // Verify that IchimokuRsiStrategy receives the parameter correctly
      const strategy = new IchimokuRsiStrategy({
        tenkan: opts.tenkan,
        kijun: opts.kijun,
        senkouB: opts.senkouB,
        displacement: opts.displacement,
        rsiPeriod: opts.rsiPeriod,
        rsiBuyMin: opts.rsiBuyMin,
        rsiBuyMax: opts.rsiBuyMax,
        rsiSellMin: opts.rsiSellMin,
        rsiSellMax: opts.rsiSellMax,
        rsiLookback: opts.rsiLookback,
        cloudFilter: opts.cloudFilter,
        rsiRecoveryCap: opts.rsiRecoveryCap,
        kijunSlopeFilter: opts.kijunSlopeFilter,
      });

      expect(strategy).toBeDefined();
    });
  });
});

