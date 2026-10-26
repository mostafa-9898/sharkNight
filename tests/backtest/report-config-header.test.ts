import { BacktestEngine } from '@/backtest/engine';
import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';
import {
  buildBacktestReport,
  formatStrategyDisplayName,
  formatFisherConfigString,
  type BacktestReportInput,
} from '@/backtest/report';
import type { Candle } from '@/data/models/candle';
import type { BacktestResult } from '@/backtest/types';

describe('PN2: Backtest Report Config Header & ST1 Signal Funnel Integration', () => {
  const createCandle = (index: number, close: number): Candle => ({
    timestamp: 1600000000000 + index * 900000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  });

  const candles: Candle[] = [];
  for (let i = 0; i < 50; i++) {
    candles.push(createCandle(i, 100 + (i % 5)));
  }

  const makeMockInput = (configOverrides: Partial<BacktestReportInput['config']> = {}): BacktestReportInput => {
    const strategy = new MultiTimeframeStrategy({
      fisherMode: 'extra-trigger',
      fisherKind: 'fisher',
      fisherGate: 'none',
    });
    const mockFunnel = {
      long: {
        raw: { tk: 5, stoch: 4, fisher: 3 },
        candidate: 6,
        passHtf: 4,
        passKijunSlope: 3,
        passStructure: 3,
        passOppositeBlock: 3,
        passFisherConfirm: 3,
        signalEmitted: 3,
        entryAttempted: 3,
        rejected: { max_positions: 0, max_exposure: 0, min_bars: 0, opposite_not_allowed: 0, other: 0 },
        rejectedTotal: 0,
        executed: 0,
      },
      short: {
        raw: { tk: 2, stoch: 1, fisher: 2 },
        candidate: 3,
        passHtf: 2,
        passKijunSlope: 2,
        passStructure: 1,
        passOppositeBlock: 1,
        passFisherConfirm: 1,
        signalEmitted: 1,
        entryAttempted: 1,
        rejected: { max_positions: 0, max_exposure: 0, min_bars: 0, opposite_not_allowed: 0, other: 0 },
        rejectedTotal: 0,
        executed: 0,
      },
    };

    const backtestResult: BacktestResult = {
      config: { strategy, initialBalance: 10000 },
      trades: [],
      metrics: {
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
        expectancy: 0,
        expectancyPercent: 0,
        profitFactor: 0,
        payoffRatio: 0,
        long: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
        short: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0 },
      },
      equity: [10000],
      signalFunnel: mockFunnel,
      trace: {
        tkCrossEvents: [],
        ignoredSignals: [],
        signalFunnel: mockFunnel,
      },
    };

    return {
      backtestResult,
      candles,
      config: {
        symbol: 'BTCUSDT',
        interval: '15m',
        fisherMode: 'extra-trigger',
        fisherKind: 'fisher',
        fisherGate: 'none',
        ...configOverrides,
      },
    };
  };

  it('PN2-a: formatFisherConfigString and formatStrategyDisplayName reflect exact Fisher parameters', () => {
    const f1Str = formatFisherConfigString({
      symbol: 'BTCUSDT',
      interval: '15m',
      fisherMode: 'extra-trigger',
      fisherKind: 'fisher',
      fisherGate: 'none',
    });
    expect(f1Str).toBe('extra-trigger/fisher/none');

    const dispName = formatStrategyDisplayName({
      symbol: 'BTCUSDT',
      interval: '15m',
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'extra-trigger',
      fisherKind: 'fisher',
      fisherGate: 'none',
    });
    expect(dispName).toContain('fisher=extra-trigger/fisher/none');

    const iftStr = formatFisherConfigString({
      symbol: 'ETHUSDT',
      interval: '15m',
      fisherMode: 'confirm',
      fisherKind: 'ift',
      fisherGate: 'zone',
    });
    expect(iftStr).toBe('confirm/ift/zone');

    const offStr = formatFisherConfigString({
      symbol: 'SOLUSDT',
      interval: '15m',
      fisherMode: 'off',
    });
    expect(offStr).toBe('off');
  });

  it('PN2-b: execution with extra-trigger outputs extra-trigger in report header and parameter table', () => {
    const input = makeMockInput({
      fisherMode: 'extra-trigger',
      fisherKind: 'fisher',
      fisherGate: 'none',
    });

    const output = buildBacktestReport(input);

    // Markdown Strategy line
    expect(output.markdown).toContain('fisher=extra-trigger/fisher/none');

    // Markdown Configuration table
    expect(output.markdown).toContain('| Fisher Oscillator | Mode / Kind / Gate | `extra-trigger (kind=fisher, gate=none)` |');

    // Diagnostics Markdown header
    expect(output.diagnosticsMarkdown).toBeDefined();
    expect(output.diagnosticsMarkdown).toContain('Fisher: extra-trigger/fisher/none');
  });

  it('PN2-c: report markdown uses ST1 Signal Funnel and completely removes legacy RSI zone columns', () => {
    const input = makeMockInput();
    const output = buildBacktestReport(input);

    // Section D must contain ST1 Funnel Stages
    expect(output.markdown).toContain('## Section D: Signal Funnel');
    expect(output.markdown).toContain('1. Raw Crosses (Active Triggers)');
    expect(output.markdown).toContain('2. Candidate Candles');
    expect(output.markdown).toContain('3. Pass HTF Strict (1h & 4h)');
    expect(output.markdown).toContain('4. Pass Kijun Slope');
    expect(output.markdown).toContain('5. Pass Structure Filter');
    expect(output.markdown).toContain('6. Pass Opposite Block');
    expect(output.markdown).toContain('7. Pass Fisher Confirm');
    expect(output.markdown).toContain('8. Signal Emitted');
    expect(output.markdown).toContain('9. Entry Attempted');
    expect(output.markdown).toContain('10. Rejected by Engine');
    expect(output.markdown).toContain('11. Executed Trades');
    expect(output.markdown).toContain('Engine Rejection Breakdown');

    // Legacy RSI zone columns must NOT be present
    expect(output.markdown).not.toContain('Crosses with RSI in Zone');
    expect(output.markdown).not.toContain('RSI out of zone within lookback');
    expect(output.markdown).not.toContain('Rejected by RSI Recovery Cap');
    expect(output.markdown).not.toContain('Rejected by Cloud Filter');

    // Diagnostics markdown also uses ST1 Signal Funnel
    expect(output.diagnosticsMarkdown).toContain('## Section 5: Decision & Signal Funnel Diagnostics');
    expect(output.diagnosticsMarkdown).toContain('1. Raw Crosses (Active Triggers)');
    expect(output.diagnosticsMarkdown).not.toContain('Crosses with RSI in Zone');
  });

  it('PN2-d: live engine execution with extra-trigger generates report containing extra-trigger and funnel reconciliation', () => {
    const strategy = new MultiTimeframeStrategy({
      fisherMode: 'extra-trigger',
      fisherKind: 'fisher',
      fisherGate: 'none',
      tenkan: 4,
      kijun: 8,
      senkouB: 16,
    });
    const engine = new BacktestEngine();
    const result = engine.run({
      strategy,
      candles,
      initialBalance: 10000,
      collectTrace: true,
    });

    const report = buildBacktestReport({
      backtestResult: result,
      candles,
      config: {
        symbol: 'BTCUSDT',
        interval: '15m',
        fisherMode: 'extra-trigger',
        fisherKind: 'fisher',
        fisherGate: 'none',
      },
    });

    expect(report.markdown).toContain('fisher=extra-trigger/fisher/none');
    expect(report.markdown).toContain('extra-trigger (kind=fisher, gate=none)');
    expect(report.markdown).toContain('## Section D: Signal Funnel');
    expect(report.markdown).toContain('11. Executed Trades');
  });
});
