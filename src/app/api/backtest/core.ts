import { BinancePublicProvider } from '@/data/providers/binance-public';
import { KucoinPublicProvider } from '@/data/providers/kucoin-public';
import { JsonStorage } from '@/data/storage/json-storage';
import type { Candle, CandleInterval } from '@/data/models/candle';
import { performCandleSanityCheck, getIntervalMs } from '@/data/models/candle';
import { BacktestEngine } from '@/backtest/engine';
import type { TradeMode, StopCheckMode, TrailingStopConfig, ExitMode, BacktestResult } from '@/backtest/types';
import { computeMfeMaeAnalysis } from '@/backtest/metrics';
import { calculateIchimoku } from '@/indicators/ichimoku';
import { calculateRSI } from '@/indicators/rsi';
import { calculateStochastic } from '@/indicators/stochastic';
import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';
import { generateAndSaveBacktestReport } from '@/backtest/report';
import {
  DEFAULT_TRADE_MODE,
  DEFAULT_POSITION_SIZE_PERCENT,
  DEFAULT_MAX_OPEN_POSITIONS,
  DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT,
  DEFAULT_MIN_BARS_BETWEEN_ENTRIES,
  DEFAULT_ALLOW_OPPOSITE_POSITIONS,
  DEFAULT_TRAILING_MODE,
  DEFAULT_INITIAL_STOP_PERCENT,
  DEFAULT_TRAIL_STEP_PERCENT,
  DEFAULT_TRAIL_RAISE_PERCENT,
  DEFAULT_FISHER_MODE,
  DEFAULT_FISHER_KIND,
  DEFAULT_FISHER_GATE,
  DEFAULT_EXIT_MODE,
  DEFAULT_INITIAL_BALANCE,
  DEFAULT_TRADE_FEE_PERCENT,
  DEFAULT_KIJUN_SLOPE_FILTER,
  DEFAULT_STRUCTURE_FILTER,
  DEFAULT_STOP_CHECK_MODE,
  DEFAULT_SLIPPAGE_PERCENT,
  DEFAULT_SYMBOL,
  DEFAULT_INTERVAL,
  DEFAULT_PERIOD,
} from '@/config/defaults';

/**
 * Fallback generator for realistic market candles in case external exchanges are completely blocked.
 */
export function generateSyntheticCandles(symbol: string, limit: number): Candle[] {
  const basePrice = symbol.startsWith('BTC') ? 80000 : symbol.startsWith('ETH') ? 3500 : 150;
  const now = Date.now();
  const intervalMs = 60 * 60 * 1000; // 1 hour
  const candles: Candle[] = [];

  let currentPrice = basePrice;
  for (let i = limit; i >= 0; i--) {
    const timestamp = now - i * intervalMs;
    const variation = (Math.random() - 0.49) * (currentPrice * 0.015);
    const open = currentPrice;
    const close = Math.max(10, open + variation);
    const high = Math.max(open, close) + Math.random() * (currentPrice * 0.005);
    const low = Math.min(open, close) - Math.random() * (currentPrice * 0.005);
    const volume = Math.round(500 + Math.random() * 2000);

    candles.push({
      timestamp,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
    });

    currentPrice = close;
  }

  return candles;
}

export interface RouteBacktestOptions {
  providedCandles?: Candle[];
  providedHtf4h?: Candle[];
  providedHtf1h?: Candle[];
}

export async function executeBacktestCore(
  body: Record<string, unknown> = {},
  options?: RouteBacktestOptions
) {
  const symbol = (body.symbol ?? DEFAULT_SYMBOL).toString().trim().toUpperCase();
  const interval = (body.interval ?? DEFAULT_INTERVAL) as CandleInterval;
  const period = (body.period ?? DEFAULT_PERIOD).toString().trim().toLowerCase();
  const rawLimit = body.limit;
  const isAll =
    period !== 'all' ||
    rawLimit === 'all' ||
    rawLimit === 0 ||
    rawLimit === '0' ||
    rawLimit === undefined ||
    rawLimit === null;
  const limit = isAll ? 150000 : Math.min(150000, Math.max(50, Number(rawLimit)));

  // Ichimoku Parameters
  const ichimokuTenkan = Math.max(2, Number(body.ichimokuTenkan ?? 9));
  const ichimokuKijun = Math.max(ichimokuTenkan + 1, Number(body.ichimokuKijun ?? 26));
  const ichimokuSenkouB = Math.max(ichimokuKijun + 1, Number(body.ichimokuSenkouB ?? 52));
  const ichimokuDisplacement = Math.max(1, Math.min(100, Number(body.ichimokuDisplacement ?? 26)));

  // RSI Parameters
  const rsiPeriod = Math.max(2, Number(body.rsiPeriod ?? 14));
  const rsiBuyMin = Math.max(1, Number(body.rsiBuyMin ?? 20));
  const rsiBuyMax = Math.max(rsiBuyMin + 1, Number(body.rsiBuyMax ?? 40));
  const rsiSellMin = Math.max(rsiBuyMax + 1, Number(body.rsiSellMin ?? 60));
  const rsiSellMax = Math.max(rsiSellMin + 1, Math.min(99, Number(body.rsiSellMax ?? 80)));
  const rsiLookback = Math.max(1, Math.min(50, Number(body.rsiLookback ?? 10)));
  const rsiRecoveryCap =
    body.rsiRecoveryCap !== undefined &&
    body.rsiRecoveryCap !== null &&
    body.rsiRecoveryCap !== '' &&
    Number(body.rsiRecoveryCap) >= 0
      ? Number(body.rsiRecoveryCap)
      : undefined;
  const htfMode: 'strict' | 'legacy' = body.htfMode === 'legacy' ? 'legacy' : 'strict';
  const entryMode: 'cross' | 'legacy' = body.entryMode === 'legacy' ? 'legacy' : 'cross';
  const kijunSlopeFilter = body.kijunSlopeFilter !== undefined ? Boolean(body.kijunSlopeFilter) : DEFAULT_KIJUN_SLOPE_FILTER;
  const structureFilter = body.structureFilter !== undefined ? Boolean(body.structureFilter) : DEFAULT_STRUCTURE_FILTER;
  const fisherMode: 'off' | 'extra-trigger' | 'replace-stoch' | 'confirm' =
    body.fisherMode === 'off' || body.fisherMode === 'extra-trigger' || body.fisherMode === 'replace-stoch' || body.fisherMode === 'confirm'
      ? body.fisherMode
      : DEFAULT_FISHER_MODE;
  const fisherKind: 'fisher' | 'ift' = body.fisherKind === 'ift' ? 'ift' : DEFAULT_FISHER_KIND;
  const fisherGate: 'none' | 'zone' = body.fisherGate === 'zone' ? 'zone' : DEFAULT_FISHER_GATE;

  const tradeMode: TradeMode =
    body.tradeMode === 'short-only'
      ? 'short-only'
      : body.tradeMode === 'long-only'
      ? 'long-only'
      : DEFAULT_TRADE_MODE;
  const exitMode: ExitMode =
    body.exitMode === 'tkCross' || body.exitMode === 'kijun' || body.exitMode === 'reverse'
      ? body.exitMode
      : DEFAULT_EXIT_MODE;
  const maxBarsInTrade =
    body.maxBarsInTrade !== undefined &&
    body.maxBarsInTrade !== null &&
    body.maxBarsInTrade !== '' &&
    Number(body.maxBarsInTrade) > 0
      ? Math.floor(Number(body.maxBarsInTrade))
      : undefined;

  const takeProfitPercent =
    body.takeProfitPercent !== undefined &&
    body.takeProfitPercent !== null &&
    body.takeProfitPercent !== '' &&
    Number(body.takeProfitPercent) > 0
      ? Number(body.takeProfitPercent)
      : undefined;
  const stopLossPercent =
    body.stopLossPercent !== undefined &&
    body.stopLossPercent !== null &&
    body.stopLossPercent !== '' &&
    Number(body.stopLossPercent) > 0
      ? Number(body.stopLossPercent)
      : 3;

  // Trailing Stop parameters
  const trailingStopEnabled =
    body.trailingStopEnabled !== undefined
      ? Boolean(body.trailingStopEnabled)
      : exitMode === 'trailingOnly';
  let trailingStop: TrailingStopConfig | undefined;

  if (trailingStopEnabled) {
    const initialStopPercent = Number(body.initialStopPercent ?? DEFAULT_INITIAL_STOP_PERCENT);
    const trailStepPercent = Number(body.trailStepPercent ?? DEFAULT_TRAIL_STEP_PERCENT);
    const trailRaisePercent = Number(body.trailRaisePercent ?? DEFAULT_TRAIL_RAISE_PERCENT);

    if (!Number.isFinite(initialStopPercent) || initialStopPercent <= 0 || initialStopPercent > 50) {
      throw new Error('initialStopPercent must be between 0 and 50%');
    }
    if (!Number.isFinite(trailStepPercent) || trailStepPercent <= 0) {
      throw new Error('trailStepPercent must be greater than 0');
    }
    if (!Number.isFinite(trailRaisePercent) || trailRaisePercent <= 0) {
      throw new Error('trailRaisePercent must be greater than 0');
    }
    if (trailRaisePercent > trailStepPercent * 1.0) {
      throw new Error('trailRaisePercent cannot exceed trailStepPercent');
    }

    const trailingMode: 'trend' | 'stepped' =
      body.trailingMode === 'trend' ? 'trend' : DEFAULT_TRAILING_MODE;

    trailingStop = {
      initialStopPercent,
      stepPercent: trailStepPercent,
      raisePercent: trailRaisePercent,
      mode: trailingMode,
    };
  }

  // Cloud filter
  const cloudFilter: 'off' | 'trend' | 'strongCross' =
    body.cloudFilter === 'trend' || body.cloudFilter === 'strongCross'
      ? body.cloudFilter
      : 'off';

  // Strategy selection: MTF or Single Timeframe
  const strategyType = (body.strategyType ?? (body.mtfEnabled ? 'mtf' : 'single')).toString().toLowerCase();
  const mtfEnabled = Boolean(body.mtfEnabled || strategyType === 'mtf');

  // Stochastic Parameters
  const stochKPeriod = Math.max(2, Number(body.stochKPeriod ?? 14));
  const stochDPeriod = Math.max(1, Number(body.stochDPeriod ?? 3));
  const stochSmooth = Math.max(1, Number(body.stochSmooth ?? 3));
  const stochOversold = Math.max(1, Math.min(50, Number(body.stochOversold ?? 30)));
  const stochOverbought = Math.max(50, Math.min(99, Number(body.stochOverbought ?? 70)));

  // TDR Stop Parameters
  const useTdrStop = Boolean(body.useTdrStop);
  const tdrMultiplier = Math.max(0.5, Number(body.tdrMultiplier ?? 1.5));
  const trendRequirement =
    body.trendRequirement === '4h_only'
      ? '4h_only'
      : body.trendRequirement === '4h_and_1h'
        ? '4h_and_1h'
        : 'either';
  const lookbackBars = Math.max(1, Number(body.lookbackBars ?? 3));
  const minConfirmations = Math.max(1, Math.min(3, Number(body.minConfirmations ?? 2)));

  // Position Sizing & Risk
  const positionSizePercent =
    body.positionSizePercent !== undefined &&
    body.positionSizePercent !== null &&
    body.positionSizePercent !== '' &&
    Number(body.positionSizePercent) > 0
      ? Math.min(100, Math.max(0.0001, Number(body.positionSizePercent)))
      : DEFAULT_POSITION_SIZE_PERCENT;

  // Multi-position parameters (R2)
  const maxOpenPositions = Math.max(1, Math.floor(Number(body.maxOpenPositions ?? DEFAULT_MAX_OPEN_POSITIONS)));
  const maxTotalExposurePercent = Math.min(100, Math.max(1, Number(body.maxTotalExposurePercent ?? DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT)));
  const minBarsBetweenEntries = Math.max(0, Math.floor(Number(body.minBarsBetweenEntries ?? DEFAULT_MIN_BARS_BETWEEN_ENTRIES)));
  const allowOppositePositions =
    body.allowOppositePositions !== undefined && body.allowOppositePositions !== null
      ? Boolean(body.allowOppositePositions)
      : DEFAULT_ALLOW_OPPOSITE_POSITIONS;

  const riskPerTradePercent =
    body.riskPerTradePercent !== undefined &&
    body.riskPerTradePercent !== null &&
    body.riskPerTradePercent !== '' &&
    Number(body.riskPerTradePercent) > 0
      ? Math.min(100, Math.max(0.01, Number(body.riskPerTradePercent)))
      : undefined;

  if (
    riskPerTradePercent !== undefined &&
    !trailingStopEnabled &&
    (stopLossPercent === undefined || stopLossPercent <= 0)
  ) {
    throw new Error('riskPerTradePercent requires an initial stopLossPercent or trailingStop to calculate position size');
  }

  const slippagePercent = Math.max(0, Number(body.slippagePercent ?? DEFAULT_SLIPPAGE_PERCENT));
  const stopCheckMode: StopCheckMode = body.stopCheckMode === 'close' ? 'close' : DEFAULT_STOP_CHECK_MODE;

  const allowSynthetic = Boolean(body.allowSynthetic);
  const initialBalance = Math.max(100, Number(body.initialBalance ?? DEFAULT_INITIAL_BALANCE));
  const tradeFeePercent = Math.max(0, Number(body.tradeFeePercent ?? DEFAULT_TRADE_FEE_PERCENT));

  let candles: Candle[] | null = options?.providedCandles ?? null;
  let dataSource: 'binance' | 'kucoin' | 'cache' | 'synthetic' = options?.providedCandles ? 'cache' : 'cache';

  if (!candles) {
    const storage = new JsonStorage();
    candles = await storage.loadCandles(symbol, interval);
    if (!candles || candles.length === 0 || (!isAll && candles.length < limit)) {
      candles = null;

      // 1. Try Binance
      try {
        const binance = new BinancePublicProvider();
        candles = await binance.fetchCandles({ symbol, interval, limit });
        if (candles && candles.length > 0) {
          dataSource = 'binance';
          await storage.saveCandles(symbol, interval, candles);
        }
      } catch {}

      // 2. If Binance failed, fallback to KuCoin
      if (!candles || candles.length === 0) {
        try {
          const kucoin = new KucoinPublicProvider();
          candles = await kucoin.fetchCandles({ symbol, interval, limit });
          if (candles && candles.length > 0) {
            dataSource = 'kucoin';
            await storage.saveCandles(symbol, interval, candles);
          }
        } catch {}
      }

      // 3. Fallback to synthetic ONLY if explicit allowSynthetic=true
      if (!candles || candles.length === 0) {
        if (allowSynthetic) {
          candles = generateSyntheticCandles(symbol, limit);
          dataSource = 'synthetic';
        } else {
          throw new Error(
            'Failed to fetch real market data from Binance and KuCoin. External exchanges are unreachable. Run backtest with allowSynthetic=true if simulated data is desired.'
          );
        }
      }
    } else {
      dataSource = 'cache';
    }
  }

  if (period !== 'all' && !options?.providedCandles) {
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
      if (!candles || candles.length === 0 || candles[0].timestamp > requiredStartTime + 2 * intervalMs) {
        throw new Error(
          `Cached data for ${symbol} ${interval} does not cover the requested ${period} window. Run: npm run download -- --years=${years} --symbols=${symbol} --intervals=${interval}`
        );
      }
      candles = candles.filter((c) => c.timestamp >= requiredStartTime);
    }
  }

  if (!isAll && candles.length > limit && !options?.providedCandles) {
    candles = candles.slice(-limit);
  }

  // Pre-load HTF candles if in MTF mode
  let htf4hCandles = options?.providedHtf4h;
  let htf1hCandles = options?.providedHtf1h;
  if (mtfEnabled && !htf4hCandles && !options?.providedCandles) {
    const storage = new JsonStorage();
    try {
      htf4hCandles = (await storage.loadCandles(symbol, '4h')) ?? undefined;
      htf1hCandles = (await storage.loadCandles(symbol, '1h')) ?? undefined;
    } catch {}
  }

  // Run Strategy Backtest using MultiTimeframeStrategy
  const strategy = new MultiTimeframeStrategy({
    htfMode: 'strict',
    entryMode: 'cross',
    kijunSlopeFilter,
    structureFilter,
    fisherMode,
    fisherKind,
    fisherGate,
    htf4hCandles,
    htf1hCandles,
    tenkan: ichimokuTenkan,
    kijun: ichimokuKijun,
    senkouB: ichimokuSenkouB,
    displacement: ichimokuDisplacement,
    rsiPeriod,
    stochKPeriod,
    stochDPeriod,
    stochSmooth,
    stochOversold,
    stochOverbought,
    initialStopPercent: trailingStopEnabled ? (trailingStop?.initialStopPercent ?? 5) : (stopLossPercent ?? 5),
    useTdrStop,
    tdrMultiplier,
  });

  const engine = new BacktestEngine();
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
    stopLossPercent: trailingStopEnabled ? undefined : stopLossPercent,
    trailingStop,
    maxOpenPositions,
    maxTotalExposurePercent,
    minBarsBetweenEntries,
    allowOppositePositions,
    slippagePercent,
    stopCheckMode,
    collectTrace: true,
  });

  // Compute indicator series for response
  const ichimokuData = calculateIchimoku(candles, {
    tenkan: ichimokuTenkan,
    kijun: ichimokuKijun,
    senkouB: ichimokuSenkouB,
    displacement: ichimokuDisplacement,
  });
  const closePrices = candles.map((c) => c.close);
  const rsiValues = calculateRSI(closePrices, rsiPeriod);
  const stochData = calculateStochastic(candles, {
    kPeriod: stochKPeriod,
    dPeriod: stochDPeriod,
    smooth: stochSmooth,
  });

  // Diagnostics calculation over entire candle series
  let rsiBuyZoneCount = 0;
  let rsiSellZoneCount = 0;
  let tkCrossUpCount = 0;
  let tkCrossDownCount = 0;

  const relation = new Int8Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const t = ichimokuData.tenkan[i];
    const k = ichimokuData.kijun[i];
    if (Number.isFinite(t) && Number.isFinite(k)) {
      relation[i] = t > k ? 1 : t < k ? -1 : 0;
    }
  }

  let tkCrossEqualityStartCount = 0;
  for (let i = 1; i < candles.length; i++) {
    const r = rsiValues[i];
    if (Number.isFinite(r)) {
      if (r >= rsiBuyMin && r <= rsiBuyMax) rsiBuyZoneCount++;
      if (r >= rsiSellMin && r <= rsiSellMax) rsiSellZoneCount++;
    }

    const prevRel = relation[i - 1];
    const currRel = relation[i];
    if (prevRel === 0 && currRel !== 0) {
      tkCrossEqualityStartCount++;
    }

    if (prevRel <= 0 && currRel > 0) tkCrossUpCount++;
    else if (prevRel >= 0 && currRel < 0) tkCrossDownCount++;
  }

  const executedTradesLong = backtestResult.trades.filter((t) => t.side === 'long').length;
  const executedTradesShort = backtestResult.trades.filter((t) => t.side === 'short').length;

  let buySignalsFallback = 0;
  let sellSignalsFallback = 0;
  if (!backtestResult.trace) {
    for (let i = 0; i < candles.length; i++) {
      const sig = strategy.analyze(candles, i);
      if (sig.action === 'BUY') buySignalsFallback++;
      else if (sig.action === 'SELL') sellSignalsFallback++;
    }
  }

  const buySetups = backtestResult.trace
    ? backtestResult.trace.tkCrossEvents.filter((e) => e.direction === 'up' && e.signalEmitted).length
    : buySignalsFallback;
  const sellSetups = backtestResult.trace
    ? backtestResult.trace.tkCrossEvents.filter((e) => e.direction === 'down' && e.signalEmitted).length
    : sellSignalsFallback;

  const diagnostics = {
    rsiBuyZoneCandles: rsiBuyZoneCount,
    rsiSellZoneCandles: rsiSellZoneCount,
    tkCrossUpEvents: tkCrossUpCount,
    tkCrossDownEvents: tkCrossDownCount,
    tkCrossEqualityStartCount,
    buySetups,
    sellSetups,
    executedTradesLong,
    executedTradesShort,
    executedTradesTotal: backtestResult.trades.length,
  };

  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const sanityCheck = performCandleSanityCheck(candles, interval);

  // Best-effort report generation (never breaks backtest response on failure)
  try {
    await generateAndSaveBacktestReport({
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
        dataSource,
        strategy: mtfEnabled ? 'mtf' : 'ichimoku-rsi',
        strategyName: mtfEnabled ? 'MultiTimeframe' : 'IchimokuRsi',
        htfMode,
        entryMode,
        structureFilter,
        tenkan: ichimokuTenkan,
        kijun: ichimokuKijun,
        senkouB: ichimokuSenkouB,
        displacement: ichimokuDisplacement,
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
        stopLossPercent: trailingStopEnabled ? undefined : stopLossPercent,
        trailingStop,
        maxOpenPositions,
        maxTotalExposurePercent,
        minBarsBetweenEntries,
        positionSizePercent,
        riskPerTradePercent,
        tradeFeePercent,
        slippagePercent,
        stopCheckMode,
        initialBalance,
      },
    });
  } catch (reportErr) {
    console.warn('Failed to generate backtest review report:', reportErr);
  }

  const strategyName = mtfEnabled ? 'MultiTimeframe' : 'IchimokuRsi';

  return {
    success: true,
    strategyName,
    symbol,
    interval,
    totalCandles: candles.length,
    startTime: firstCandle?.timestamp ?? null,
    endTime: lastCandle?.timestamp ?? null,
    isFullDataset: isAll || candles.length >= 2000,
    dataSource,
    sanityCheck,
    candles,
    indicators: {
      ichimoku: {
        tenkan: ichimokuData.tenkan,
        kijun: ichimokuData.kijun,
        senkouA: ichimokuData.senkouA,
        senkouB: ichimokuSenkouB,
        chikou: ichimokuData.chikou,
        params: {
          tenkan: ichimokuTenkan,
          kijun: ichimokuKijun,
          senkouB: ichimokuSenkouB,
          displacement: ichimokuDisplacement,
        },
      },
      rsi: {
        values: rsiValues,
        period: rsiPeriod,
        buyMin: rsiBuyMin,
        buyMax: rsiBuyMax,
        sellMin: rsiSellMin,
        sellMax: rsiSellMax,
      },
      stochastic: {
        k: stochData.k,
        d: stochData.d,
        params: {
          kPeriod: stochKPeriod,
          dPeriod: stochDPeriod,
          smooth: stochSmooth,
          oversold: stochOversold,
          overbought: stochOverbought,
        },
      },
      mtf: {
        enabled: mtfEnabled,
        strategyType,
        useTdrStop,
        tdrMultiplier,
        trendRequirement,
        htf4hCandlesCount: htf4hCandles?.length ?? 0,
        htf1hCandlesCount: htf1hCandles?.length ?? 0,
      },
      rsiLookback,
      tradeMode,
      takeProfitPercent,
      stopLossPercent,
      trailingStop: trailingStopEnabled && trailingStop
        ? {
            enabled: true,
            initialStopPercent: trailingStop.initialStopPercent,
            stepPercent: trailingStop.stepPercent,
            raisePercent: trailingStop.raisePercent,
          }
        : { enabled: false },
      slippagePercent,
      stopCheckMode,
      cloudFilter,
      rsiRecoveryCap,
      exitMode,
      maxBarsInTrade,
      period,
      positionSizePercent,
      riskPerTradePercent,
    },
    diagnostics,
    backtestResult,
  };
}

export async function runBacktestFromRoute(
  body: Record<string, unknown> = {},
  options?: RouteBacktestOptions
): Promise<BacktestResult> {
  const result = await executeBacktestCore(body, options);
  return result.backtestResult;
}
