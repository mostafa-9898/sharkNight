import { JsonStorage } from '../data/storage/json-storage';
import { getIntervalMs, type Candle, type CandleInterval } from '../data/models/candle';
import { BacktestEngine } from '../backtest/engine';
import { IchimokuRsiStrategy, type CloudFilter } from '../strategies/ichimoku-rsi-strategy';
import { calculateIchimoku } from '../indicators/ichimoku';
import { calculateRSI } from '../indicators/rsi';
import { generateAndSaveBacktestReport } from '../backtest/report';
import type {
  TradeMode,
  ExitMode,
  StopCheckMode,
  TrailingStopConfig,
  BacktestMetrics,
} from '../backtest/types';

export function parseArg(
  key: string,
  defaultValue?: string,
  argv: string[] = process.argv.slice(2)
): string | undefined {
  const prefix = `--${key}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
  }
  return defaultValue;
}

export function parseNumArg(
  key: string,
  defaultValue?: number,
  argv: string[] = process.argv.slice(2)
): number | undefined {
  const val = parseArg(key, undefined, argv);
  if (val !== undefined && val !== '') {
    const num = Number(val);
    if (Number.isFinite(num)) return num;
    throw new Error(`Invalid numeric value for argument --${key}: "${val}".`);
  }
  return defaultValue;
}

export function parseTimestampArg(
  key: string,
  defaultValue?: number,
  argv: string[] = process.argv.slice(2)
): number | undefined {
  const val = parseArg(key, undefined, argv);
  if (val === undefined || val === '') return defaultValue;
  const trimmed = val.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      return num < 1e11 ? num * 1000 : num;
    }
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  throw new Error(
    `Invalid timestamp value for argument --${key}: "${val}". Expected ISO-8601 string or numeric timestamp in milliseconds.`
  );
}

export function parseBoolArg(
  key: string,
  defaultValue = false,
  argv: string[] = process.argv.slice(2)
): boolean {
  const flag = `--${key}`;
  const prefix = `--${key}=`;
  for (const arg of argv) {
    if (arg === flag) {
      return true;
    }
    if (arg.startsWith(prefix)) {
      const rawVal = arg.slice(prefix.length).trim();
      const val = rawVal.toLowerCase();
      if (val === 'true' || val === '1' || val === 'yes') return true;
      if (val === 'false' || val === '0' || val === 'no') return false;
      throw new Error(
        `Invalid boolean value for argument --${key}: "${rawVal}". Expected true, false, 1, 0, yes, or no.`
      );
    }
  }
  return defaultValue;
}

export const SUPPORTED_PERIODS = ['all', '1y', '2y', '3y', '6y'] as const;
export type SupportedPeriod = (typeof SUPPORTED_PERIODS)[number];

export function validatePeriod(period: string): SupportedPeriod {
  const normalized = period.trim().toLowerCase();
  if (!SUPPORTED_PERIODS.includes(normalized as SupportedPeriod)) {
    throw new Error(
      `Invalid period: "${period}". Supported periods are: ${SUPPORTED_PERIODS.join(', ')}.`
    );
  }
  return normalized as SupportedPeriod;
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)) {
  const symbol = (parseArg('symbol', 'BTCUSDT', argv) ?? 'BTCUSDT').toUpperCase();
  const interval = (parseArg('interval', '1h', argv) ?? '1h') as CandleInterval;
  const rawPeriod = parseArg('period', '6y', argv) ?? '6y';
  const period = validatePeriod(rawPeriod);

  // Strategy params
  const tenkan = parseNumArg('tenkan', 9, argv)!;
  const kijun = parseNumArg('kijun', 26, argv)!;
  const senkouB = parseNumArg('senkouB', 52, argv)!;
  const displacement = parseNumArg('displacement', 26, argv)!;
  const rsiPeriod = parseNumArg('rsiPeriod', 14, argv)!;
  const rsiBuyMin = parseNumArg('rsiBuyMin', 20, argv)!;
  const rsiBuyMax = parseNumArg('rsiBuyMax', 40, argv)!;
  const rsiSellMin = parseNumArg('rsiSellMin', 60, argv)!;
  const rsiSellMax = parseNumArg('rsiSellMax', 80, argv)!;
  const rsiLookback = parseNumArg('rsiLookback', 10, argv)!;
  const cloudFilter = (parseArg('cloudFilter', 'off', argv) ?? 'off') as CloudFilter;
  const rsiRecoveryCap = parseNumArg('rsiRecoveryCap', undefined, argv);
  const kijunSlopeFilter = parseBoolArg('kijunSlopeFilter', false, argv);

  // Engine params
  const tradeMode = (parseArg('tradeMode', 'long-short', argv) ?? 'long-short') as TradeMode;
  const exitMode = (parseArg('exitMode', 'reverse', argv) ?? 'reverse') as ExitMode;
  const maxBarsInTrade = parseNumArg('maxBarsInTrade', undefined, argv);
  const initialBalance = parseNumArg('initialBalance', 10000, argv)!;
  const tradeFeePercent = parseNumArg('tradeFeePercent', 0.1, argv)!;
  const positionSizePercent = parseNumArg('positionSizePercent', 20, argv)!;
  const riskPerTradePercent = parseNumArg('riskPerTradePercent', 1, argv)!;
  const slippagePercent = parseNumArg('slippagePercent', 0, argv)!;
  const stopCheckMode = (parseArg('stopCheckMode', 'intrabar', argv) ?? 'intrabar') as StopCheckMode;

  // Trailing stop
  let trailingStop: TrailingStopConfig | undefined = {
    initialStopPercent: 5,
    stepPercent: 10,
    raisePercent: 5,
  };
  const trailingArg = parseArg('trailingStop', undefined, argv);
  if (trailingArg === 'false' || trailingArg === 'off' || trailingArg === '0') {
    trailingStop = undefined;
  } else if (trailingArg && trailingArg.includes('/')) {
    const parts = trailingArg.split('/').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      trailingStop = {
        initialStopPercent: parts[0],
        stepPercent: parts[1],
        raisePercent: parts[2],
      };
    }
  }

  const stopLossPercent = parseNumArg('stopLossPercent', undefined, argv);
  const takeProfitPercent = parseNumArg('takeProfitPercent', undefined, argv);

  // Time window parameters (precedence: startTime/endTime > asOf > latest cached candle anchor)
  const startTime = parseTimestampArg('startTime', undefined, argv);
  const endTime = parseTimestampArg('endTime', undefined, argv);
  const asOf = parseTimestampArg('asOf', undefined, argv);

  if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
    throw new Error(
      `Invalid time window: --startTime (${new Date(startTime).toISOString()}) must be <= --endTime (${new Date(endTime).toISOString()}).`
    );
  }

  return {
    symbol,
    interval,
    period,
    startTime,
    endTime,
    asOf,
    tenkan,
    kijun,
    senkouB,
    displacement,
    rsiPeriod,
    rsiBuyMin,
    rsiBuyMax,
    rsiSellMin,
    rsiSellMax,
    rsiLookback,
    cloudFilter,
    rsiRecoveryCap,
    kijunSlopeFilter,
    tradeMode,
    exitMode,
    maxBarsInTrade,
    initialBalance,
    tradeFeePercent,
    positionSizePercent,
    riskPerTradePercent,
    slippagePercent,
    stopCheckMode,
    trailingStop,
    stopLossPercent,
    takeProfitPercent,
  };
}

export interface ResolveCandleWindowParams {
  candles: readonly Candle[];
  interval: CandleInterval;
  period?: string;
  startTime?: number;
  endTime?: number;
  asOf?: number;
}

export type CoverageStatus =
  | 'full'
  | 'left_truncated'
  | 'right_truncated'
  | 'both_truncated'
  | 'out_of_bounds'
  | 'empty';

export interface ResolvedCandleWindow {
  candles: Candle[];
  effectiveStartTime?: number;
  effectiveEndTime?: number;
  requestedStartTime?: number;
  requestedEndTime?: number;
  isCapped: boolean;
  anchorTime?: number;
  coverageStatus: CoverageStatus;
  coverageWarning?: string;
}

export function resolveEffectiveCandleWindow(
  params: ResolveCandleWindowParams
): ResolvedCandleWindow {
  const { candles, interval, period = '6y', startTime, endTime, asOf } = params;
  if (!candles || candles.length === 0) {
    return {
      candles: [],
      effectiveStartTime: undefined,
      effectiveEndTime: undefined,
      requestedStartTime: undefined,
      requestedEndTime: undefined,
      isCapped: false,
      coverageStatus: 'empty',
    };
  }

  const validPeriod = validatePeriod(period);
  const intervalMs = getIntervalMs(interval);
  const yearsMap: Record<Exclude<SupportedPeriod, 'all'>, number> = {
    '1y': 1,
    '2y': 2,
    '3y': 3,
    '6y': 6,
  };

  const cacheStart = candles[0].timestamp;
  const cacheEnd = candles[candles.length - 1].timestamp;

  // Determine reference anchor for relative periods:
  // Precedence:
  // 1. Explicit --asOf
  // 2. Explicit --endTime
  // 3. Latest cached candle timestamp (deterministic anchor derived from dataset)
  let anchorTime: number;
  if (asOf !== undefined) {
    anchorTime = asOf;
  } else if (endTime !== undefined) {
    anchorTime = endTime;
  } else {
    anchorTime = cacheEnd;
  }

  // Align anchor to candle interval
  const alignedAnchor = Math.floor(anchorTime / intervalMs) * intervalMs;

  // Determine requestedEndTime:
  // Explicit --endTime takes precedence, aligned to candle interval; otherwise alignedAnchor
  const requestedEndTime =
    endTime !== undefined ? Math.floor(endTime / intervalMs) * intervalMs : alignedAnchor;

  // Determine requestedStartTime:
  // Explicit --startTime takes precedence over relative --period
  let requestedStartTime: number;
  let isRelative = false;

  if (startTime !== undefined) {
    requestedStartTime = Math.floor(startTime / intervalMs) * intervalMs;
  } else if (validPeriod !== 'all') {
    isRelative = true;
    const years = yearsMap[validPeriod];
    const periodDurationMs = Math.round(years * 365.25 * 24 * 60 * 60 * 1000);
    const alignedPeriodMs = Math.round(periodDurationMs / intervalMs) * intervalMs;
    requestedStartTime = requestedEndTime - alignedPeriodMs;
  } else {
    requestedStartTime = cacheStart;
  }

  // Evaluate coverage boundaries
  let isLeftTruncated = false;
  if (startTime !== undefined) {
    isLeftTruncated = requestedStartTime < cacheStart;
  } else if (isRelative) {
    isLeftTruncated = cacheStart > requestedStartTime + 2 * intervalMs;
  }

  let isRightTruncated = false;
  if (endTime !== undefined) {
    isRightTruncated = requestedEndTime > cacheEnd;
  }
  if (asOf !== undefined && asOf > cacheEnd) {
    isRightTruncated = true;
  }

  const isOutOfBounds =
    (asOf !== undefined && asOf < cacheStart) ||
    requestedStartTime > cacheEnd ||
    requestedEndTime < cacheStart;

  let coverageStatus: CoverageStatus = 'full';
  let coverageWarning: string | undefined;

  if (isOutOfBounds) {
    coverageStatus = 'out_of_bounds';
    coverageWarning =
      asOf !== undefined && asOf < cacheStart
        ? `Requested asOf anchor (${new Date(asOf).toISOString()}) is earlier than earliest available cached candle (${new Date(cacheStart).toISOString()}).`
        : `Requested time window (${new Date(requestedStartTime).toISOString()} to ${new Date(requestedEndTime).toISOString()}) does not intersect available cached candles (${new Date(cacheStart).toISOString()} to ${new Date(cacheEnd).toISOString()}).`;
  } else if (isLeftTruncated && isRightTruncated) {
    coverageStatus = 'both_truncated';
    coverageWarning = `Requested time window (${new Date(requestedStartTime).toISOString()} to ${new Date(requestedEndTime).toISOString()}) exceeds cached candle range (${new Date(cacheStart).toISOString()} to ${new Date(cacheEnd).toISOString()}) on both boundaries.`;
  } else if (isLeftTruncated) {
    coverageStatus = 'left_truncated';
    coverageWarning = `Requested start time (${new Date(requestedStartTime).toISOString()}) is earlier than earliest available cached candle (${new Date(cacheStart).toISOString()}). Cached dataset cannot fully cover the requested period.`;
  } else if (isRightTruncated) {
    coverageStatus = 'right_truncated';
    const detail =
      asOf !== undefined && asOf > cacheEnd
        ? `Requested asOf anchor (${new Date(asOf).toISOString()}) is later than latest available cached candle (${new Date(cacheEnd).toISOString()}).`
        : `Requested end time (${new Date(requestedEndTime).toISOString()}) is later than latest available cached candle (${new Date(cacheEnd).toISOString()}).`;
    coverageWarning = `${detail} Cached dataset cannot fully cover the requested period.`;
  }

  const isCapped = coverageStatus !== 'full';

  const filteredCandles = candles.filter(
    (c) => c.timestamp >= requestedStartTime && c.timestamp <= requestedEndTime
  );

  const effectiveStartTime =
    filteredCandles.length > 0 ? filteredCandles[0].timestamp : undefined;
  const effectiveEndTime =
    filteredCandles.length > 0 ? filteredCandles[filteredCandles.length - 1].timestamp : undefined;

  return {
    candles: filteredCandles,
    effectiveStartTime,
    effectiveEndTime,
    requestedStartTime,
    requestedEndTime,
    isCapped,
    anchorTime: alignedAnchor,
    coverageStatus,
    coverageWarning,
  };
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const {
    symbol,
    interval,
    period,
    startTime,
    endTime,
    asOf,
    tenkan,
    kijun,
    senkouB,
    displacement,
    rsiPeriod,
    rsiBuyMin,
    rsiBuyMax,
    rsiSellMin,
    rsiSellMax,
    rsiLookback,
    cloudFilter,
    rsiRecoveryCap,
    kijunSlopeFilter,
    tradeMode,
    exitMode,
    maxBarsInTrade,
    initialBalance,
    tradeFeePercent,
    positionSizePercent,
    riskPerTradePercent,
    slippagePercent,
    stopCheckMode,
    trailingStop,
    stopLossPercent,
    takeProfitPercent,
  } = parseCliArgs(argv);

  console.log(`\n======================================================`);
  console.log(`🤖 Starting Headless Backtest Report Generator`);
  console.log(`Target: ${symbol} (${interval}) | Period: ${period}`);
  console.log(`======================================================\n`);

  // 1. Load real data from storage
  const storage = new JsonStorage();
  const rawCandles = await storage.loadCandles(symbol, interval);
  if (!rawCandles || rawCandles.length === 0) {
    console.error(`❌ Error: No cached candle data found for ${symbol} (${interval}).`);
    console.error(`Please download historical data first: npm run download -- --symbols=${symbol} --intervals=${interval}`);
    process.exit(1);
  }

  const initialCandleCount = rawCandles.length;
  const { candles, isCapped, coverageStatus, coverageWarning } = resolveEffectiveCandleWindow({
    candles: rawCandles,
    interval,
    period,
    startTime,
    endTime,
    asOf,
  });

  if (isCapped && coverageWarning) {
    console.warn(`⚠️ Window Coverage Warning: ${coverageWarning}`);
  }

  if (candles.length === 0) {
    console.error(`❌ Error: Candle series is empty after applying window filter.`);
    if (coverageWarning) {
      console.error(`   Details: ${coverageWarning}`);
    }
    process.exit(1);
  }

  console.log(`📊 Loaded ${candles.length.toLocaleString()} candles (filtered from ${initialCandleCount.toLocaleString()}).`);
  console.log(`Window: ${new Date(candles[0].timestamp).toISOString()} to ${new Date(candles[candles.length - 1].timestamp).toISOString()}`);

  // 2. Initialize Strategy & BacktestEngine
  const strategy = new IchimokuRsiStrategy({
    tenkan,
    kijun,
    senkouB,
    displacement,
    rsiPeriod,
    rsiBuyMin,
    rsiBuyMax,
    rsiSellMin,
    rsiSellMax,
    rsiLookback,
    cloudFilter,
    rsiRecoveryCap,
    kijunSlopeFilter,
  });

  const engine = new BacktestEngine();
  console.log(`⚡ Executing backtest simulation with passive event tracing...`);

  const backtestResult = engine.run({
    strategy,
    candles,
    initialBalance,
    tradeFeePercent,
    positionSizePercent,
    riskPerTradePercent,
    tradeMode,
    exitMode,
    maxBarsInTrade,
    takeProfitPercent,
    stopLossPercent: trailingStop ? undefined : stopLossPercent,
    trailingStop,
    slippagePercent,
    stopCheckMode,
    collectTrace: true,
  });

  // 3. Compute indicators for report
  const ichimokuData = calculateIchimoku(candles, {
    tenkan,
    kijun,
    senkouB,
    displacement,
  });
  const rsiValues = calculateRSI(candles.map((c) => c.close), rsiPeriod);

  // 4. Generate and save reports
  console.log(`📝 Formatting and writing markdown and json reports...`);
  const { report, paths } = await generateAndSaveBacktestReport({
    backtestResult,
    candles,
    indicators: {
      ichimoku: ichimokuData,
      rsi: rsiValues,
    },
    config: {
      symbol,
      interval,
      period,
      dataSource: 'cache',
      startTime,
      endTime,
      asOf,
      isCapped,
      coverageStatus,
      coverageWarning,
      tenkan,
      kijun,
      senkouB,
      displacement,
      rsiPeriod,
      rsiBuyMin,
      rsiBuyMax,
      rsiSellMin,
      rsiSellMax,
      rsiLookback,
      cloudFilter,
      rsiRecoveryCap,
      kijunSlopeFilter,
      tradeMode,
      exitMode,
      maxBarsInTrade,
      takeProfitPercent,
      stopLossPercent: trailingStop ? undefined : stopLossPercent,
      trailingStop,
      positionSizePercent,
      riskPerTradePercent,
      tradeFeePercent,
      slippagePercent,
      stopCheckMode,
      initialBalance,
    },
  });

  // 5. Console summary
  const m = backtestResult.metrics;
  const flags = (report.json as { flags?: Array<{ level: string; message: string }> }).flags ?? [];
  const summaryText = formatCliSummary({
    metrics: m,
    configHash: report.configHash,
    paths,
    flags,
  });
  console.log(`\n${summaryText}\n`);
}

export interface CliSummaryParams {
  metrics: BacktestMetrics;
  configHash: string;
  paths: {
    latestMdPath: string;
    latestJsonPath: string;
    historyMdPath: string;
    historyIndexUpdated: boolean;
  };
  flags?: Array<{ level: string; message: string }>;
}

export function formatCliSummary(params: CliSummaryParams): string {
  const { metrics: m, configHash, paths, flags = [] } = params;
  const lines: string[] = [
    `======================================================`,
    `✅ Backtest Report Successfully Generated!`,
    `======================================================`,
    `📁 Files Written:`,
    `   - Latest Markdown: ${paths.latestMdPath}`,
    `   - Latest JSON:     ${paths.latestJsonPath}`,
    `   - History Archive: ${paths.historyMdPath}`,
    `   - Index Table:     docs/review/HISTORY.md (${paths.historyIndexUpdated ? 'updated' : 'unchanged'})`,
    ``,
    `📈 Performance Summary:`,
    `   - Net Return:      ${m.totalPnlPercent > 0 ? '+' : ''}${m.totalPnlPercent.toFixed(2)}% ($${m.totalPnl.toFixed(2)})`,
    `   - Max Drawdown:    ${m.maxDrawdownPercent.toFixed(2)}%`,
    `   - Total Trades:    ${m.totalTrades} (Long: ${m.long.totalTrades} | Short: ${m.short.totalTrades})`,
    `   - Win Rate:        ${m.totalTrades > 0 ? `${(m.winRate * 100).toFixed(1)}%` : 'N/A'}`,
    `   - Config Hash:     ${configHash}`,
  ];

  if (flags.length > 0) {
    lines.push(``);
    lines.push(`🚩 Warnings Triggered (${flags.length}):`);
    for (const f of flags) {
      lines.push(`   [${f.level}] ${f.message}`);
    }
  } else {
    lines.push(``);
    lines.push(`✨ Zero warning flags triggered.`);
  }
  lines.push(`======================================================`);
  return lines.join('\n');
}

if (process.env.NODE_ENV !== 'test') {
  runCli().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}

