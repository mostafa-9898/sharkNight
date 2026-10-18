import {
  parseArg,
  parseNumArg,
  parseBoolArg,
  parseTimestampArg,
  parseCliArgs,
  formatCliSummary,
  resolveEffectiveCandleWindow,
} from '@/scripts/backtest-report';
import { IchimokuRsiStrategy } from '@/strategies/ichimoku-rsi-strategy';
import type { BacktestMetrics } from '@/backtest/types';
import type { Candle } from '@/data/models/candle';

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

  describe('parseTimestampArg', () => {
    it('parses valid ISO-8601 strings to millisecond timestamps', () => {
      const iso = '2024-01-01T00:00:00.000Z';
      const expected = Date.parse(iso);
      expect(parseTimestampArg('startTime', undefined, [`--startTime=${iso}`])).toBe(expected);
    });

    it('parses numeric epoch timestamps', () => {
      expect(parseTimestampArg('endTime', undefined, ['--endTime=1704067200000'])).toBe(1704067200000);
    });

    it('returns default value when argument is omitted', () => {
      expect(parseTimestampArg('startTime', undefined, [])).toBeUndefined();
      expect(parseTimestampArg('startTime', 12345, ['--other=foo'])).toBe(12345);
    });

    it('throws descriptive error on invalid timestamp strings', () => {
      expect(() => parseTimestampArg('startTime', undefined, ['--startTime=not-a-date'])).toThrow(
        /Invalid timestamp value for argument --startTime/
      );
    });
  });

  describe('parseCliArgs & Strategy parameter forwarding', () => {
    it('correctly maps default CLI arguments', () => {
      const opts = parseCliArgs([]);
      expect(opts.symbol).toBe('BTCUSDT');
      expect(opts.interval).toBe('1h');
      expect(opts.period).toBe('6y');
      expect(opts.startTime).toBeUndefined();
      expect(opts.endTime).toBeUndefined();
      expect(opts.asOf).toBeUndefined();
      expect(opts.tenkan).toBe(9);
      expect(opts.kijun).toBe(26);
      expect(opts.senkouB).toBe(52);
      expect(opts.kijunSlopeFilter).toBe(false);
      expect(opts.cloudFilter).toBe('off');
    });

    it('correctly parses --startTime, --endTime, and --asOf options', () => {
      const opts = parseCliArgs([
        '--startTime=2023-01-01T00:00:00.000Z',
        '--endTime=2023-12-31T23:59:59.000Z',
        '--asOf=2024-01-01T00:00:00.000Z',
      ]);
      expect(opts.startTime).toBe(Date.parse('2023-01-01T00:00:00.000Z'));
      expect(opts.endTime).toBe(Date.parse('2023-12-31T23:59:59.000Z'));
      expect(opts.asOf).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
    });

    it('throws error when --startTime is strictly greater than --endTime', () => {
      expect(() =>
        parseCliArgs([
          '--startTime=2024-01-02T00:00:00.000Z',
          '--endTime=2024-01-01T00:00:00.000Z',
        ])
      ).toThrow(/Invalid time window: --startTime .* must be <= --endTime/);
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

  describe('formatCliSummary', () => {
    const mockPaths = {
      latestMdPath: '/path/to/BACKTEST_LATEST.md',
      latestJsonPath: '/path/to/backtest-latest.json',
      historyMdPath: '/path/to/history/archive.md',
      historyIndexUpdated: true,
    };

    const baseMetrics: BacktestMetrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      averageTradeReturn: 0,
      bestTrade: 0,
      worstTrade: 0,
      finalBalance: 10000,
      totalFees: 0,
      totalFeesPercent: 0,
      averageWin: 0,
      averageLoss: 0,
      feeDragPercent: 0,
      long: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
      short: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
    };

    it('formats Win Rate as N/A on zero executed trades', () => {
      const summary = formatCliSummary({
        metrics: baseMetrics,
        configHash: 'f8e53fab',
        paths: mockPaths,
        flags: [{ level: 'CRITICAL', message: 'Zero Trades Executed' }],
      });

      expect(summary).toContain('- Total Trades:    0 (Long: 0 | Short: 0)');
      expect(summary).toContain('- Win Rate:        N/A');
      expect(summary).toContain('- Config Hash:     f8e53fab');
      expect(summary).toContain('[CRITICAL] Zero Trades Executed');
    });

    it('formats legitimate percentage win rate when trades are executed', () => {
      const metricsWithTrades: BacktestMetrics = {
        ...baseMetrics,
        totalTrades: 4,
        winningTrades: 1,
        losingTrades: 3,
        winRate: 0.25,
        totalPnl: -150,
        totalPnlPercent: -1.5,
        long: { totalTrades: 2, winningTrades: 1, losingTrades: 1, winRate: 0.5, totalPnl: 50, totalPnlPercent: 0.5 },
        short: { totalTrades: 2, winningTrades: 0, losingTrades: 2, winRate: 0, totalPnl: -200, totalPnlPercent: -2.0 },
      };

      const summary = formatCliSummary({
        metrics: metricsWithTrades,
        configHash: 'abc12345',
        paths: mockPaths,
      });

      expect(summary).toContain('- Total Trades:    4 (Long: 2 | Short: 2)');
      expect(summary).toContain('- Win Rate:        25.0%');
      expect(summary).toContain('✨ Zero warning flags triggered.');
    });

    it('preserves valid 0.0% win rate when trades exist but none are winners', () => {
      const zeroWinsMetrics: BacktestMetrics = {
        ...baseMetrics,
        totalTrades: 2,
        winningTrades: 0,
        losingTrades: 2,
        winRate: 0.0,
        totalPnl: -200,
        totalPnlPercent: -2.0,
        long: { totalTrades: 2, winningTrades: 0, losingTrades: 2, winRate: 0.0, totalPnl: -200, totalPnlPercent: -2.0 },
      };

      const summary = formatCliSummary({
        metrics: zeroWinsMetrics,
        configHash: 'xyz98765',
        paths: mockPaths,
      });

      expect(summary).toContain('- Total Trades:    2 (Long: 2 | Short: 0)');
      expect(summary).toContain('- Win Rate:        0.0%');
    });
  });

  describe('resolveEffectiveCandleWindow', () => {
    const oneHour = 60 * 60 * 1000;
    const baseTime = Date.parse('2024-01-01T00:00:00.000Z');

    function makeMockCandles(count: number, start = baseTime, step = oneHour): Candle[] {
      return Array.from({ length: count }, (_, i) => ({
        timestamp: start + i * step,
        open: 100 + i,
        high: 105 + i,
        low: 95 + i,
        close: 102 + i,
        volume: 1000,
      }));
    }

    it('returns empty result for empty candles array', () => {
      const result = resolveEffectiveCandleWindow({
        candles: [],
        interval: '1h',
      });
      expect(result.candles).toEqual([]);
      expect(result.effectiveStartTime).toBeUndefined();
      expect(result.effectiveEndTime).toBeUndefined();
      expect(result.isCapped).toBe(false);
    });

    it('is completely deterministic regardless of system wall-clock (Date.now())', () => {
      const candles = makeMockCandles(100);
      const originalNow = Date.now;

      try {
        // Run with Date.now() in 2024
        jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-06-01T00:00:00.000Z'));
        const run1 = resolveEffectiveCandleWindow({
          candles,
          interval: '1h',
          period: '1y',
        });

        // Run with Date.now() simulated in 2035
        (Date.now as jest.Mock).mockReturnValue(Date.parse('2035-12-31T00:00:00.000Z'));
        const run2 = resolveEffectiveCandleWindow({
          candles,
          interval: '1h',
          period: '1y',
        });

        expect(run1.effectiveStartTime).toBe(run2.effectiveStartTime);
        expect(run1.effectiveEndTime).toBe(run2.effectiveEndTime);
        expect(run1.anchorTime).toBe(run2.anchorTime);
        expect(run1.candles.length).toBe(run2.candles.length);
        expect(run1.candles[0].timestamp).toBe(run2.candles[0].timestamp);
        expect(run1.candles[run1.candles.length - 1].timestamp).toBe(
          run2.candles[run2.candles.length - 1].timestamp
        );
      } finally {
        Date.now = originalNow;
      }
    });

    it('anchors relative period to the latest cached candle timestamp aligned to interval', () => {
      // Latest candle is at baseTime + 99 * oneHour
      const candles = makeMockCandles(100);
      const latestCandle = candles[candles.length - 1];

      const result = resolveEffectiveCandleWindow({
        candles,
        interval: '1h',
        period: '1y',
      });

      expect(result.anchorTime).toBe(latestCandle.timestamp);
      expect(result.effectiveEndTime).toBe(latestCandle.timestamp);
      expect(result.isCapped).toBe(true); // 100 hours is less than 1 year, so capped
      expect(result.candles).toEqual(candles);
    });

    it('allows --asOf to override the relative anchor', () => {
      const candles = makeMockCandles(100);
      // Pick an asOf that is halfway through the dataset
      const asOfTime = candles[50].timestamp;

      const result = resolveEffectiveCandleWindow({
        candles,
        interval: '1h',
        period: '1y',
        asOf: asOfTime,
      });

      expect(result.anchorTime).toBe(asOfTime);
      expect(result.effectiveEndTime).toBe(asOfTime);
      expect(result.candles.length).toBe(51);
      expect(result.candles[result.candles.length - 1].timestamp).toBe(asOfTime);
    });

    it('allows explicit --startTime and --endTime to override relative period completely', () => {
      const candles = makeMockCandles(100);
      const customStart = candles[10].timestamp;
      const customEnd = candles[25].timestamp;

      const result = resolveEffectiveCandleWindow({
        candles,
        interval: '1h',
        startTime: customStart,
        endTime: customEnd,
      });

      expect(result.effectiveStartTime).toBe(customStart);
      expect(result.effectiveEndTime).toBe(customEnd);
      expect(result.candles.length).toBe(16);
      expect(result.candles[0].timestamp).toBe(customStart);
      expect(result.candles[result.candles.length - 1].timestamp).toBe(customEnd);
    });

    it('aligns unaligned --startTime and --endTime to candle interval', () => {
      const candles = makeMockCandles(20);
      // Give unaligned timestamps (with +15 minutes)
      const unalignedStart = candles[2].timestamp + 15 * 60 * 1000;
      const unalignedEnd = candles[10].timestamp + 45 * 60 * 1000;

      const result = resolveEffectiveCandleWindow({
        candles,
        interval: '1h',
        startTime: unalignedStart,
        endTime: unalignedEnd,
      });

      expect(result.effectiveStartTime).toBe(candles[2].timestamp);
      expect(result.effectiveEndTime).toBe(candles[10].timestamp);
    });

    it('returns all candles when period is "all"', () => {
      const candles = makeMockCandles(50);
      const result = resolveEffectiveCandleWindow({
        candles,
        interval: '1h',
        period: 'all',
      });

      expect(result.candles.length).toBe(50);
      expect(result.isCapped).toBe(false);
      expect(result.effectiveStartTime).toBe(candles[0].timestamp);
    });
  });
});


