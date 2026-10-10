'use client';

import React, { useEffect, useRef } from 'react';
import type {
  IChartApi,
  UTCTimestamp,
  SeriesMarker,
} from 'lightweight-charts';
import type { Candle } from '@/data/models/candle';
import type { Trade } from '@/backtest/types';

interface CandleChartProps {
  candles: Candle[];
  smaFast?: number[];
  smaSlow?: number[];
  fastPeriod?: number;
  slowPeriod?: number;
  trades?: Trade[];
}

export default function CandleChart({
  candles,
  smaFast,
  smaSlow,
  fastPeriod = 10,
  slowPeriod = 30,
  trades = [],
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) {
      return;
    }

    let isMounted = true;

    // Clean previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    let handleResize: (() => void) | null = null;

    import('lightweight-charts').then(
      ({ createChart, CandlestickSeries, LineSeries, ColorType, createSeriesMarkers }) => {
        if (!isMounted || !containerRef.current) {
          return;
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

        // Candlestick series
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#2ea043',
          downColor: '#f85149',
          borderVisible: false,
          wickUpColor: '#2ea043',
          wickDownColor: '#f85149',
        });

        const formattedCandles = candles.map((c) => ({
          time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

        candleSeries.setData(formattedCandles);

        // Fast SMA line
        if (smaFast && smaFast.length === candles.length) {
          const fastLineSeries = chart.addSeries(LineSeries, {
            color: '#38bdf8', // Light blue
            lineWidth: 2,
            title: `SMA ${fastPeriod}`,
          });

          const fastData = candles
            .map((c, i) => ({
              time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
              value: smaFast[i],
            }))
            .filter((d) => !Number.isNaN(d.value));

          fastLineSeries.setData(fastData);
        }

        // Slow SMA line
        if (smaSlow && smaSlow.length === candles.length) {
          const slowLineSeries = chart.addSeries(LineSeries, {
            color: '#fbbf24', // Amber/Yellow
            lineWidth: 2,
            title: `SMA ${slowPeriod}`,
          });

          const slowData = candles
            .map((c, i) => ({
              time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
              value: smaSlow[i],
            }))
            .filter((d) => !Number.isNaN(d.value));

          slowLineSeries.setData(slowData);
        }

        // Add Trade Markers (BUY & SELL)
        if (trades.length > 0) {
          const markers: SeriesMarker<UTCTimestamp>[] = [];

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

          if (markers.length > 0) {
            createSeriesMarkers(candleSeries, markers);
          }
        }

        chart.timeScale().fitContent();

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
      }
    };
  }, [candles, smaFast, smaSlow, fastPeriod, slowPeriod, trades]);

  return (
    <div
      style={{
        backgroundColor: '#161b22',
        borderRadius: '8px',
        border: '1px solid #30363d',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 600, color: '#f0f6fc' }}>Candlestick & Strategy Signals</span>
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
          <span style={{ color: '#38bdf8' }}>● Fast SMA ({fastPeriod})</span>
          <span style={{ color: '#fbbf24' }}>● Slow SMA ({slowPeriod})</span>
          <span style={{ color: '#2ea043' }}>▲ Buy Signal</span>
          <span style={{ color: '#f85149' }}>▼ Sell Signal</span>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '480px' }} />
    </div>
  );
}

