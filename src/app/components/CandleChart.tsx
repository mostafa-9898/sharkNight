'use client';

import React, { useEffect, useRef } from 'react';
import type {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  SeriesMarker,
} from 'lightweight-charts';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { Trade } from '@/backtest/types';

interface CandleChartProps {
  candles: Candle[];
  symbol?: string;
  smaFast?: number[];
  smaSlow?: number[];
  fastPeriod?: number;
  slowPeriod?: number;
  trades?: Trade[];
  currentInterval?: CandleInterval;
  onIntervalChange?: (interval: CandleInterval) => void;
  loading?: boolean;
}

const TIMEFRAME_PILLS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export default function CandleChart({
  candles,
  symbol = 'BTCUSDT',
  smaFast,
  smaSlow,
  fastPeriod = 10,
  slowPeriod = 30,
  trades = [],
  currentInterval = '1h',
  onIntervalChange,
  loading = false,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const fastLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const slowLineRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Initialize chart canvas once
  useEffect(() => {
    if (!containerRef.current) return;

    let isMounted = true;
    let handleResize: (() => void) | null = null;

    import('lightweight-charts').then(
      ({ createChart, CandlestickSeries, LineSeries, ColorType }) => {
        if (!isMounted || !containerRef.current) return;

        // Clean previous if any
        if (chartRef.current) {
          chartRef.current.remove();
        }

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: 480,
          layout: {
            background: { type: ColorType.Solid, color: '#161b22' },
            textColor: '#8b949e',
          },
          grid: {
            vertLines: { color: '#21262d' },
            horzLines: { color: '#21262d' },
          },
          timeScale: {
            borderColor: '#30363d',
            timeVisible: true,
            secondsVisible: false,
          },
          rightPriceScale: {
            borderColor: '#30363d',
          },
        });

        chartRef.current = chart;

        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#2ea043',
          downColor: '#f85149',
          borderVisible: false,
          wickUpColor: '#2ea043',
          wickDownColor: '#f85149',
        });
        candleSeriesRef.current = candleSeries;

        const fastLine = chart.addSeries(LineSeries, {
          color: '#38bdf8',
          lineWidth: 2,
          title: `SMA ${fastPeriod}`,
        });
        fastLineRef.current = fastLine;

        const slowLine = chart.addSeries(LineSeries, {
          color: '#fbbf24',
          lineWidth: 2,
          title: `SMA ${slowPeriod}`,
        });
        slowLineRef.current = slowLine;

        handleResize = () => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: containerRef.current.clientWidth,
            });
          }
        };

        window.addEventListener('resize', handleResize);
      }
    );

    return () => {
      isMounted = false;
      if (handleResize) {
        window.removeEventListener('resize', handleResize);
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        fastLineRef.current = null;
        slowLineRef.current = null;
      }
    };
  }, []); // Run ONCE on mount!

  // Instant data update without chart re-creation!
  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current || candles.length === 0) {
      return;
    }

    import('lightweight-charts').then(({ createSeriesMarkers }) => {
      if (!candleSeriesRef.current || !chartRef.current) return;

      const formattedCandles = candles.map((c) => ({
        time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      candleSeriesRef.current.setData(formattedCandles);

      // Fast SMA update
      if (fastLineRef.current) {
        fastLineRef.current.applyOptions({ title: `SMA ${fastPeriod}` });
        if (smaFast && smaFast.length === candles.length) {
          const fastData = candles
            .map((c, i) => ({
              time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
              value: smaFast[i],
            }))
            .filter((d) => typeof d.value === 'number' && Number.isFinite(d.value));
          fastLineRef.current.setData(fastData);
        } else {
          fastLineRef.current.setData([]);
        }
      }

      // Slow SMA update
      if (slowLineRef.current) {
        slowLineRef.current.applyOptions({ title: `SMA ${slowPeriod}` });
        if (smaSlow && smaSlow.length === candles.length) {
          const slowData = candles
            .map((c, i) => ({
              time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
              value: smaSlow[i],
            }))
            .filter((d) => typeof d.value === 'number' && Number.isFinite(d.value));
          slowLineRef.current.setData(slowData);
        } else {
          slowLineRef.current.setData([]);
        }
      }

      // Trade markers
      const markers: SeriesMarker<UTCTimestamp>[] = [];
      if (trades.length > 0) {
        for (const trade of trades) {
          if (trade.entryTime) {
            markers.push({
              time: Math.floor(trade.entryTime / 1000) as UTCTimestamp,
              position: 'belowBar',
              color: '#2ea043',
              shape: 'arrowUp',
              text: `BUY @ $${trade.entryPrice.toLocaleString()}`,
            });
          }
          if (trade.exitTime) {
            const isWin = trade.pnl > 0;
            markers.push({
              time: Math.floor(trade.exitTime / 1000) as UTCTimestamp,
              position: 'aboveBar',
              color: isWin ? '#38bdf8' : '#f85149',
              shape: 'arrowDown',
              text: `SELL (${isWin ? '+' : ''}${trade.pnlPercent.toFixed(1)}%)`,
            });
          }
        }
        markers.sort((a, b) => Number(a.time) - Number(b.time));
      }
      createSeriesMarkers(candleSeriesRef.current, markers);

      chartRef.current.timeScale().fitContent();
    });
  }, [candles, smaFast, smaSlow, fastPeriod, slowPeriod, trades]);

  return (
    <div
      style={{
        backgroundColor: '#161b22',
        borderRadius: '8px',
        border: '1px solid #30363d',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Chart Header with Timeframe Pills */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, color: '#f0f6fc', marginRight: '6px', fontSize: '13px' }}>
            {symbol}
          </span>
          <span style={{ fontSize: '12px', color: '#8b949e', marginRight: '4px' }}>Timeframe:</span>
          {TIMEFRAME_PILLS.map((tf) => {
            const isActive = tf === currentInterval;
            return (
              <button
                key={tf}
                onClick={() => onIntervalChange?.(tf)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: isActive ? 700 : 500,
                  backgroundColor: isActive ? '#38bdf8' : '#21262d',
                  color: isActive ? '#0d1117' : '#c9d1d9',
                  transition: 'all 0.15s ease',
                  cursor: 'pointer',
                  border: 'none',
                }}
              >
                {tf}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '14px', fontSize: '12px', alignItems: 'center' }}>
          {smaFast && smaFast.length > 0 && (
            <>
              <span style={{ color: '#38bdf8' }}>● Fast SMA ({fastPeriod})</span>
              <span style={{ color: '#fbbf24' }}>● Slow SMA ({slowPeriod})</span>
            </>
          )}
          {trades.length > 0 && (
            <>
              <span style={{ color: '#2ea043' }}>▲ Buy</span>
              <span style={{ color: '#f85149' }}>▼ Sell</span>
            </>
          )}
          <span style={{ color: '#8b949e' }}>
            {candles.length.toLocaleString()} Candles
          </span>
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: '49px',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(22, 27, 34, 0.75)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '12px',
            zIndex: 10,
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid #30363d',
              borderTopColor: '#38bdf8',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span style={{ fontSize: '13px', color: '#e6edf3' }}>Updating Chart Data...</span>
        </div>
      )}

      {/* Container */}
      <div ref={containerRef} style={{ width: '100%', height: '480px' }} />

      <style jsx global>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
