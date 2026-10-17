import { JsonStorage } from '../data/storage/json-storage';
import { getIntervalMs, type CandleInterval } from '../data/models/candle';
import { BacktestEngine } from '../backtest/engine';
import { IchimokuRsiStrategy, type CloudFilter } from '../strategies/ichimoku-rsi-strategy';
import { calculateIchimoku } from '../indicators/ichimoku';
import { calculateRSI } from '../indicators/rsi';
import { generateAndSaveBacktestReport } from '../backtest/report';
import type { TradeMode, ExitMode, StopCheckMode, TrailingStopConfig } from '../backtest/types';

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

export function parseCliArgs(argv: string[] = process.argv.slice(2)) {
  const symbol = (parseArg('symbol', 'BTCUSDT', argv) ?? 'BTCUSDT').toUpperCase();
  const interval = (parseArg('interval', '1h', argv) ?? '1h') as CandleInterval;
  const period = (parseArg('period', '6y', argv) ?? '6y').toLowerCase();

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

  return {
    symbol,
    interval,
    period,
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

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const {
    symbol,
    interval,
    period,
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
  let candles = await storage.loadCandles(symbol, interval);
  if (!candles || candles.length === 0) {
    console.error(`❌ Error: No cached candle data found for ${symbol} (${interval}).`);
    console.error(`Please download historical data first: npm run download -- --symbols=${symbol} --intervals=${interval}`);
    process.exit(1);
  }

  const initialCandleCount = candles.length;
  if (period !== 'all') {
    const yearsMap: Record<string, number> = {
      '1y': 1,
      '2y': 2,
      '3y': 3,
      '6y': 6,
    };
    const years = yearsMap[period];
    if (years) {
      const intervalMs = getIntervalMs(interval);
      const requiredStartTime = Date.now() - Math.round(years * 365.25 * 24 * 60 * 60 * 1000);
      if (candles[0].timestamp > requiredStartTime + 2 * intervalMs) {
        console.warn(
          `⚠️ Warning: Cached candles for ${symbol} ${interval} do not span the requested full ${period}. Using available candles.`
        );
      }
      candles = candles.filter((c) => c.timestamp >= requiredStartTime);
    }
  }

  if (candles.length === 0) {
    console.error(`❌ Error: Candle series is empty after applying period filter.`);
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
  console.log(`\n======================================================`);
  console.log(`✅ Backtest Report Successfully Generated!`);
  console.log(`======================================================`);
  console.log(`📁 Files Written:`);
  console.log(`   - Latest Markdown: ${paths.latestMdPath}`);
  console.log(`   - Latest JSON:     ${paths.latestJsonPath}`);
  console.log(`   - History Archive: ${paths.historyMdPath}`);
  console.log(`   - Index Table:     docs/review/HISTORY.md (${paths.historyIndexUpdated ? 'updated' : 'unchanged'})`);
  console.log(`\n📈 Performance Summary:`);
  console.log(`   - Net Return:      ${m.totalPnlPercent > 0 ? '+' : ''}${m.totalPnlPercent.toFixed(2)}% ($${m.totalPnl.toFixed(2)})`);
  console.log(`   - Max Drawdown:    ${m.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`   - Total Trades:    ${m.totalTrades} (Long: ${m.long.totalTrades} | Short: ${m.short.totalTrades})`);
  console.log(`   - Win Rate:        ${m.totalTrades > 0 ? `${(m.winRate * 100).toFixed(1)}%` : 'N/A'}`);
  console.log(`   - Config Hash:     ${report.configHash}`);

  const flags = (report.json as { flags?: Array<{ level: string; message: string }> }).flags ?? [];
  if (flags.length > 0) {
    console.log(`\n🚩 Warnings Triggered (${flags.length}):`);
    for (const f of flags) {
      console.log(`   [${f.level}] ${f.message}`);
    }
  } else {
    console.log(`\n✨ Zero warning flags triggered.`);
  }
  console.log(`======================================================\n`);
}

if (process.env.NODE_ENV !== 'test') {
  runCli().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}

