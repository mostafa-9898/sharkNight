'use client';

import React, { useEffect, useRef } from 'react';
import type {
  IChartApi,
  UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/data/models/candle';

interface EquityChartProps {
  candles: Candle[];
  equity: number[];
  initialBalance: number;
}

export default function EquityChart({
  candles,
  equity,
  initialBalance,
}: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || equity.length === 0 || candles.length === 0) {
      return;
    }

    let isMounted = true;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    let handleResize: (() => void) | null = null;

    import('lightweight-charts').then(({ createChart, AreaSeries, ColorType }) => {
      if (!isMounted || !containerRef.current) {
        return;
      }

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 240,
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
        },
        rightPriceScale: {
          borderColor: '#30363d',
        },
      });

      chartRef.current = chart;

      const finalBalance = equity[equity.length - 1] ?? initialBalance;
      const isProfit = finalBalance >= initialBalance;

      const areaSeries = chart.addSeries(AreaSeries, {
        topColor: isProfit ? 'rgba(46, 160, 67, 0.4)' : 'rgba(248, 81, 73, 0.4)',
        bottomColor: isProfit ? 'rgba(46, 160, 67, 0.02)' : 'rgba(248, 81, 73, 0.02)',
        lineColor: isProfit ? '#2ea043' : '#f85149',
        lineWidth: 2,
      });

      const data = candles
        .slice(0, equity.length)
        .map((c, i) => ({
          time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
          value: equity[i],
        }))
        .filter((d) => !Number.isNaN(d.value));

      areaSeries.setData(data);
      chart.timeScale().fitContent();

      handleResize = () => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);
    });

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
  }, [candles, equity, initialBalance]);

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
        <span style={{ fontWeight: 600, color: '#f0f6fc' }}>Portfolio Equity Curve ($)</span>
        <span style={{ fontSize: '13px', color: '#8b949e' }}>Initial: ${initialBalance.toLocaleString()}</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '240px' }} />
    </div>
  );
}

