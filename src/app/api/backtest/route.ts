import { NextResponse } from 'next/server';
import { BinancePublicProvider } from '@/data/providers/binance-public';
import { KucoinPublicProvider } from '@/data/providers/kucoin-public';
import { JsonStorage } from '@/data/storage/json-storage';
import type { Candle, CandleInterval } from '@/data/models/candle';
import { performCandleSanityCheck, getIntervalMs } from '@/data/models/candle';
import { BacktestEngine } from '@/backtest/engine';
import type { TradeMode, StopCheckMode, TrailingStopConfig, ExitMode } from '@/backtest/types';
import { computeMfeMaeAnalysis } from '@/backtest/metrics';
import { calculateIchimoku } from '@/indicators/ichimoku';
import { calculateRSI } from '@/indicators/rsi';
import { IchimokuRsiStrategy, type CloudFilter } from '@/strategies/ichimoku-rsi-strategy';
import { generateAndSaveBacktestReport } from '@/backtest/report';

/**
 * Fallback generator for realistic market candles in case external exchanges are completely blocked.
 */
function generateSyntheticCandles(symbol: string, limit: number): Candle[] {
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = (body.symbol ?? 'BTCUSDT').toString().trim().toUpperCase();
    const interval = (body.interval ?? '1h') as CandleInterval;
    const period = (body.period ?? 'all').toString().trim().toLowerCase();
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

    // Trade Mode & Risk Management
    const tradeMode: TradeMode = body.tradeMode === 'long-only' ? 'long-only' : 'long-short';
    const exitMode: ExitMode =
      body.exitMode === 'tkCross' || body.exitMode === 'kijun' ? body.exitMode : 'reverse';
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
        : undefined;

    // Trailing Stop parameters
    const trailingStopEnabled = Boolean(body.trailingStopEnabled);
    let trailingStop: TrailingStopConfig | undefined;

    if (trailingStopEnabled) {
      const initialStopPercent = Number(body.initialStopPercent ?? 5);
      const trailStepPercent = Number(body.trailStepPercent ?? 10);
      const trailRaisePercent = Number(body.trailRaisePercent ?? 5);

      if (!Number.isFinite(initialStopPercent) || initialStopPercent <= 0 || initialStopPercent > 50) {
        return NextResponse.json(
          { success: false, error: 'initialStopPercent must be between 0 and 50%' },
          { status: 400 }
        );
      }
      if (!Number.isFinite(trailStepPercent) || trailStepPercent <= 0) {
        return NextResponse.json(
          { success: false, error: 'trailStepPercent must be greater than 0' },
          { status: 400 }
        );
      }
      if (!Number.isFinite(trailRaisePercent) || trailRaisePercent <= 0) {
        return NextResponse.json(
          { success: false, error: 'trailRaisePercent must be greater than 0' },
          { status: 400 }
        );
      }
      if (trailRaisePercent > trailStepPercent * 1.0) {
        return NextResponse.json(
          { success: false, error: 'trailRaisePercent cannot exceed trailStepPercent' },
          { status: 400 }
        );
      }

      trailingStop = {
        initialStopPercent,
        stepPercent: trailStepPercent,
        raisePercent: trailRaisePercent,
      };
    }

    // Cloud filter
    const cloudFilter: CloudFilter =
      body.cloudFilter === 'trend' || body.cloudFilter === 'strongCross'
        ? body.cloudFilter
        : 'off';

    // Position Sizing & Risk
    const positionSizePercent =
      body.positionSizePercent !== undefined &&
      body.positionSizePercent !== null &&
      body.positionSizePercent !== '' &&
      Number(body.positionSizePercent) > 0
        ? Math.min(100, Math.max(0.0001, Number(body.positionSizePercent)))
        : undefined;

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
      return NextResponse.json(
        {
          success: false,
          error:
            'riskPerTradePercent requires an initial stopLossPercent or trailingStop to calculate position size',
        },
        { status: 400 }
      );
    }

    const slippagePercent = Math.max(0, Number(body.slippagePercent ?? 0));
    const stopCheckMode: StopCheckMode = body.stopCheckMode === 'close' ? 'close' : 'intrabar';

    const allowSynthetic = Boolean(body.allowSynthetic);
    const initialBalance = Math.max(100, Number(body.initialBalance ?? 10000));
    const tradeFeePercent = Math.max(0, Number(body.tradeFeePercent ?? 0.1));

    const storage = new JsonStorage();
    let candles: Candle[] | null = await storage.loadCandles(symbol, interval);
    let dataSource: 'binance' | 'kucoin' | 'cache' | 'synthetic' = 'cache';

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
      } catch {
        // Binance failed (likely geo-blocked or unreachable)
      }

      // 2. If Binance failed, fallback to KuCoin
      if (!candles || candles.length === 0) {
        try {
          const kucoin = new KucoinPublicProvider();
          candles = await kucoin.fetchCandles({ symbol, interval, limit });
          if (candles && candles.length > 0) {
            dataSource = 'kucoin';
            await storage.saveCandles(symbol, interval, candles);
          }
        } catch {
          // KuCoin failed
        }
      }

      // 3. Fallback to synthetic ONLY if explicit allowSynthetic=true
      if (!candles || candles.length === 0) {
        if (allowSynthetic) {
          candles = generateSyntheticCandles(symbol, limit);
          dataSource = 'synthetic';
          // NEVER save synthetic candles to storage!
        } else {
          return NextResponse.json(
            {
              success: false,
              error:
                'Failed to fetch real market data from Binance and KuCoin. External exchanges are unreachable. Run backtest with allowSynthetic=true if simulated data is desired.',
            },
            { status: 503 }
          );
        }
      }
    } else {
      dataSource = 'cache';
    }

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
        if (!candles || candles.length === 0 || candles[0].timestamp > requiredStartTime + 2 * intervalMs) {
          return NextResponse.json(
            {
              success: false,
              error: `Cached data for ${symbol} ${interval} does not cover the requested ${period} window. Run: npm run download -- --years=${years} --symbols=${symbol} --intervals=${interval}`,
            },
            { status: 400 }
          );
        }
        candles = candles.filter((c) => c.timestamp >= requiredStartTime);
      }
    }

    if (!isAll && candles.length > limit) {
      candles = candles.slice(-limit);
    }

    // Run Strategy Backtest using IchimokuRsiStrategy
    const strategy = new IchimokuRsiStrategy({
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

    // Diagnostics calculation over entire candle series
    let rsiBuyZoneCount = 0;
    let rsiSellZoneCount = 0;
    let tkCrossUpCount = 0;
    let tkCrossDownCount = 0;
    let buySetupsCount = 0;
    let sellSetupsCount = 0;

    const relation = new Int8Array(candles.length);
    for (let i = 0; i < candles.length; i++) {
      const t = ichimokuData.tenkan[i];
      const k = ichimokuData.kijun[i];
      if (Number.isFinite(t) && Number.isFinite(k)) {
        relation[i] = t > k ? 1 : t < k ? -1 : 0;
      }
    }

    let tkCrossEqualityStartCount = 0;

    for (let i = 0; i < candles.length; i++) {
      const rsiVal = rsiValues[i];
      if (Number.isFinite(rsiVal)) {
        if (rsiVal >= rsiBuyMin && rsiVal <= rsiBuyMax) {
          rsiBuyZoneCount++;
        }
        if (rsiVal >= rsiSellMin && rsiVal <= rsiSellMax) {
          rsiSellZoneCount++;
        }
      }

      if (i >= 1) {
        const curT = ichimokuData.tenkan[i];
        const curK = ichimokuData.kijun[i];
        const prevT = ichimokuData.tenkan[i - 1];
        const prevK = ichimokuData.kijun[i - 1];

        if (
          Number.isFinite(curT) &&
          Number.isFinite(curK) &&
          Number.isFinite(prevT) &&
          Number.isFinite(prevK)
        ) {
          const oldCrossUp = prevT <= prevK && curT > curK;
          const oldCrossDown = prevT >= prevK && curT < curK;
          if (oldCrossUp && prevT === prevK) tkCrossEqualityStartCount++;
          if (oldCrossDown && prevT === prevK) tkCrossEqualityStartCount++;

          const curRel = relation[i];
          if (curRel !== 0) {
            let lastNonZero = 0;
            for (let k = i - 1; k >= 0; k--) {
              if (relation[k] !== 0) {
                lastNonZero = relation[k];
                break;
              }
            }

            const isCrossUp = curRel === 1 && lastNonZero === -1;
            const isCrossDown = curRel === -1 && lastNonZero === 1;

            if (isCrossUp) {
              tkCrossUpCount++;
              const lookbackStart = Math.max(0, i - rsiLookback + 1);
              let hasRsiInZone = false;
              for (let k = i; k >= lookbackStart; k--) {
                const v = rsiValues[k];
                if (Number.isFinite(v) && v >= rsiBuyMin && v <= rsiBuyMax) {
                  hasRsiInZone = true;
                  break;
                }
              }
              if (hasRsiInZone) {
                buySetupsCount++;
              }
            }

            if (isCrossDown) {
              tkCrossDownCount++;
              const lookbackStart = Math.max(0, i - rsiLookback + 1);
              let hasRsiInZone = false;
              for (let k = i; k >= lookbackStart; k--) {
                const v = rsiValues[k];
                if (Number.isFinite(v) && v >= rsiSellMin && v <= rsiSellMax) {
                  hasRsiInZone = true;
                  break;
                }
              }
              if (hasRsiInZone) {
                sellSetupsCount++;
              }
            }
          }
        }
      }
    }

    const executedTradesLong = backtestResult.trades.filter((t) => t.side === 'long').length;
    const executedTradesShort = backtestResult.trades.filter((t) => t.side === 'short').length;

    const diagnostics = {
      rsiBuyZoneCandles: rsiBuyZoneCount,
      rsiSellZoneCandles: rsiSellZoneCount,
      tkCrossUpEvents: tkCrossUpCount,
      tkCrossDownEvents: tkCrossDownCount,
      tkCrossEqualityStartCount,
      buySetups: buySetupsCount,
      sellSetups: sellSetupsCount,
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
          tradeMode,
          exitMode,
          maxBarsInTrade,
          takeProfitPercent,
          stopLossPercent: trailingStopEnabled ? undefined : stopLossPercent,
          trailingStop,
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

    return NextResponse.json({
      success: true,
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
          senkouB: ichimokuData.senkouB,
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
      backtest: {
        metrics: backtestResult.metrics,
        trades: backtestResult.trades,
        equity: backtestResult.equity,
        activePosition: backtestResult.activePosition,
        mfeMaeAnalysis: computeMfeMaeAnalysis(backtestResult.trades),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
