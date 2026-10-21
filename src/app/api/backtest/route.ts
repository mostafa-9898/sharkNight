import { NextResponse } from 'next/server';
import { executeBacktestCore } from './core';
import { computeMfeMaeAnalysis } from '@/backtest/metrics';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await executeBacktestCore(body);
    return NextResponse.json({
      success: true,
      strategyName: result.strategyName,
      symbol: result.symbol,
      interval: result.interval,
      totalCandles: result.totalCandles,
      startTime: result.startTime,
      endTime: result.endTime,
      isFullDataset: result.isFullDataset,
      dataSource: result.dataSource,
      sanityCheck: result.sanityCheck,
      candles: result.candles,
      indicators: result.indicators,
      diagnostics: result.diagnostics,
      backtest: {
        metrics: result.backtestResult.metrics,
        trades: result.backtestResult.trades,
        equity: result.backtestResult.equity,
        activePosition: result.backtestResult.activePosition,
        multiPositionDiagnostics: result.backtestResult.multiPositionDiagnostics,
        mfeMaeAnalysis: computeMfeMaeAnalysis(result.backtestResult.trades),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
