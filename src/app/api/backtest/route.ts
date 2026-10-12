import { NextResponse } from 'next/server';
import { BinancePublicProvider } from '@/data/providers/binance-public';
import { KucoinPublicProvider } from '@/data/providers/kucoin-public';
import { JsonStorage } from '@/data/storage/json-storage';
import type { Candle, CandleInterval } from '@/data/models/candle';
import { performCandleSanityCheck } from '@/data/models/candle';
import { BacktestEngine } from '@/backtest/engine';
import { calculateSMA } from '@/indicators/sma';
import { calculateRSI } from '@/indicators/rsi';

import { calculateEMA } from '@/indicators/ema';
import { calculateMACD } from '@/indicators/macd';
import { ModularStrategy, type ExitMode } from '@/strategies/modular-strategy';

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
    const rawLimit = body.limit;
    const isAll =
      rawLimit === 'all' ||
      rawLimit === 0 ||
      rawLimit === '0' ||
      rawLimit === undefined ||
      rawLimit === null;
    const limit = isAll ? 150000 : Math.min(150000, Math.max(50, Number(rawLimit)));

    // Indicator parameters
    const maEnabled = body.maEnabled !== undefined ? Boolean(body.maEnabled) : true;
    const maType = (body.maType === 'sma' ? 'sma' : 'ema') as 'ema' | 'sma';
    const fastPeriod = Math.max(2, Number(body.fastPeriod ?? 10));
    const slowPeriod = Math.max(fastPeriod + 1, Number(body.slowPeriod ?? 30));

    const rsiEnabled = Boolean(body.rsiEnabled);
    const rsiPeriod = Math.max(2, Number(body.rsiPeriod ?? 14));
    const rsiBuyMin = Math.max(1, Number(body.rsiBuyMin ?? 25));
    const rsiBuyMax = Math.max(rsiBuyMin + 1, Number(body.rsiBuyMax ?? 35));
    const rsiSellMin = Math.max(rsiBuyMax + 1, Number(body.rsiSellMin ?? 65));
    const rsiSellMax = Math.max(rsiSellMin + 1, Math.min(99, Number(body.rsiSellMax ?? 75)));

    const macdEnabled = Boolean(body.macdEnabled);
    const macdFastPeriod = Math.max(2, Number(body.macdFastPeriod ?? 12));
    const macdSlowPeriod = Math.max(macdFastPeriod + 1, Number(body.macdSlowPeriod ?? 26));
    const macdSignalPeriod = Math.max(2, Number(body.macdSignalPeriod ?? 9));

    const confirmationWindow = Math.max(1, Math.min(20, Number(body.confirmationWindow ?? 6)));
    const rsiLookback = Math.max(1, Math.min(50, Number(body.rsiLookback ?? 10)));
    const exitMode = (body.exitMode === 'emaCross' || body.exitMode === 'macdCross' ? body.exitMode : 'mirror') as ExitMode;
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

    const allowSynthetic = Boolean(body.allowSynthetic);

    const initialBalance = Math.max(100, Number(body.initialBalance ?? 10000));
    const tradeFeePercent = Math.max(0, Number(body.tradeFeePercent ?? 0.1));

    if (!maEnabled && !rsiEnabled && !macdEnabled) {
      return NextResponse.json(
        { success: false, error: 'At least one indicator must be enabled to run backtest.' },
        { status: 400 }
      );
    }

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

    if (!isAll && candles.length > limit) {
      candles = candles.slice(-limit);
    }

    // Run Strategy Backtest using ModularStrategy (Strategy 1)
    const strategy = new ModularStrategy({
      ma: {
        enabled: maEnabled,
        type: maType,
        fastPeriod,
        slowPeriod,
      },
      rsi: {
        enabled: rsiEnabled,
        period: rsiPeriod,
        buyMin: rsiBuyMin,
        buyMax: rsiBuyMax,
        sellMin: rsiSellMin,
        sellMax: rsiSellMax,
      },
      macd: {
        enabled: macdEnabled,
        fastPeriod: macdFastPeriod,
        slowPeriod: macdSlowPeriod,
        signalPeriod: macdSignalPeriod,
      },
      confirmationWindow,
      rsiLookback,
      exitMode,
      takeProfitPercent,
      stopLossPercent,
    });

    const engine = new BacktestEngine();
    const backtestResult = engine.run({
      strategy,
      candles,
      initialBalance,
      tradeFeePercent,
    });

    const closePrices = candles.map((c) => c.close);
    const fastValues = maType === 'ema' ? calculateEMA(closePrices, fastPeriod) : calculateSMA(closePrices, fastPeriod);
    const slowValues = maType === 'ema' ? calculateEMA(closePrices, slowPeriod) : calculateSMA(closePrices, slowPeriod);
    const rsiValues = calculateRSI(closePrices, rsiPeriod);
    const macdValues = calculateMACD(closePrices, {
      fastPeriod: macdFastPeriod,
      slowPeriod: macdSlowPeriod,
      signalPeriod: macdSignalPeriod,
    });

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    const sanityCheck = performCandleSanityCheck(candles, interval);

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
        maEnabled,
        maType,
        fastPeriod,
        slowPeriod,
        smaFast: fastValues,
        smaSlow: slowValues,
        rsiEnabled,
        rsiPeriod,
        rsiBuyMin,
        rsiBuyMax,
        rsiSellMin,
        rsiSellMax,
        rsi: rsiValues,
        macdEnabled,
        macd: macdValues,
        confirmationWindow,
        rsiLookback,
        exitMode,
        takeProfitPercent,
        stopLossPercent,
      },
      backtest: {
        metrics: backtestResult.metrics,
        trades: backtestResult.trades,
        equity: backtestResult.equity,
        activePosition: backtestResult.activePosition,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
