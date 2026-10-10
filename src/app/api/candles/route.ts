import { NextResponse } from 'next/server';
import { JsonStorage } from '@/data/storage/json-storage';
import { BinancePublicProvider } from '@/data/providers/binance-public';
import { KucoinPublicProvider } from '@/data/providers/kucoin-public';
import type { Candle, CandleInterval } from '@/data/models/candle';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') ?? 'BTCUSDT').toString().trim().toUpperCase();
    const interval = (searchParams.get('interval') ?? '15m') as CandleInterval;
    const rawLimit = searchParams.get('limit');
    const isAll = !rawLimit || rawLimit === 'all' || rawLimit === '0';
    const limit = isAll ? 150000 : Math.min(150000, Math.max(50, Number(rawLimit)));

    const storage = new JsonStorage();
    let candles: Candle[] | null = await storage.loadCandles(symbol, interval);

    if (!candles || candles.length === 0) {
      // Fallback: try KuCoin first, then Binance
      try {
        const kucoin = new KucoinPublicProvider();
        candles = await kucoin.fetchCandles({ symbol, interval, limit: Math.min(limit, 5000) });
      } catch {
        // KuCoin failed
      }

      if (!candles || candles.length === 0) {
        try {
          const binance = new BinancePublicProvider();
          candles = await binance.fetchCandles({ symbol, interval, limit: Math.min(limit, 1000) });
        } catch {
          // Binance failed
        }
      }

      if (candles && candles.length > 0) {
        await storage.saveCandles(symbol, interval, candles);
      }
    }

    if (!candles) {
      candles = [];
    }

    if (!isAll && candles.length > limit) {
      candles = candles.slice(-limit);
    }

    return NextResponse.json({
      success: true,
      symbol,
      interval,
      totalCandles: candles.length,
      candles,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
