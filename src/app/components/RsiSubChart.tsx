'use client';

import React, { useEffect, useRef } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/data/models/candle';
import { calculateRSI } from '@/indicators/rsi';

interface RsiSubChartProps {
  candles: Candle[];
  rsiValues?: number[];
  period?: number;
  rsiPeriod?: number;
  rsiBuyMin?: number;
  rsiBuyMax?: number;
  rsiSellMin?: number;
  rsiSellMax?: number;
  onClose?: () => void;
  mainChartRef?: React.MutableRefObject<IChartApi | null>;
}

export default function RsiSubChart({
  candles,
  rsiValues,
  period = 14,
  rsiPeriod,
  rsiBuyMin = 20,
  rsiBuyMax = 40,
  rsiSellMin = 60,
  rsiSellMax = 80,
  onClose,
  mainChartRef,
}: RsiSubChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const effectivePeriod = rsiPeriod ?? period;

  const calculatedRsi = React.useMemo(() => {
    if (rsiValues && rsiValues.length === candles.length) {
      return rsiValues;
    }
    if (candles.length === 0) return [];
    return calculateRSI(
      candles.map((c) => c.close),
      effectivePeriod
    );
  }, [candles, rsiValues, effectivePeriod]);

  const lastRsiValue = React.useMemo(() => {
    for (let i = calculatedRsi.length - 1; i >= 0; i--) {
      const val = calculatedRsi[i];
      if (typeof val === 'number' && Number.isFinite(val)) {
        return val;
      }
    }
    return null;
  }, [calculatedRsi]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    let isMounted = true;
    let handleResize: (() => void) | null = null;
    let unsubscribeMain: (() => void) | null = null;
    let unsubscribeRsi: (() => void) | null = null;

    import('lightweight-charts').then(
      ({ createChart, LineSeries, ColorType, LineStyle }) => {
        if (!isMounted || !containerRef.current) return;

        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: 130,
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
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
        });

        chartRef.current = chart;

        const rsiSeries = chart.addSeries(LineSeries, {
          color: '#a855f7',
          lineWidth: 2,
          priceFormat: {
            type: 'custom',
            formatter: (p: number) => p.toFixed(1),
          },
        });

        // Strategy Sell Zone [rsiSellMin, rsiSellMax]
        rsiSeries.createPriceLine({
          price: rsiSellMax,
          color: 'rgba(239, 68, 68, 0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Sell Max (${rsiSellMax})`,
        });
        rsiSeries.createPriceLine({
          price: rsiSellMin,
          color: 'rgba(239, 68, 68, 0.3)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `Sell Min (${rsiSellMin})`,
        });

        // Strategy Buy Zone [rsiBuyMin, rsiBuyMax]
        rsiSeries.createPriceLine({
          price: rsiBuyMax,
          color: 'rgba(34, 197, 94, 0.3)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `Buy Max (${rsiBuyMax})`,
        });
        rsiSeries.createPriceLine({
          price: rsiBuyMin,
          color: 'rgba(34, 197, 94, 0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Buy Min (${rsiBuyMin})`,
        });

        // Set RSI data
        const seriesData = candles
          .map((c, i) => ({
            time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
            value: calculatedRsi[i],
          }))
          .filter((d) => typeof d.value === 'number' && Number.isFinite(d.value));

        rsiSeries.setData(seriesData);

        // Sync with main chart timescale
        if (mainChartRef?.current) {
          const mainRange = mainChartRef.current.timeScale().getVisibleLogicalRange();
          if (mainRange) {
            chart.timeScale().setVisibleLogicalRange(mainRange);
          }

          let isSyncing = false;

          const mainHandler = (range: { from: number; to: number } | null) => {
            if (isSyncing || !range || !chartRef.current) return;
            isSyncing = true;
            chartRef.current.timeScale().setVisibleLogicalRange(range);
            isSyncing = false;
          };

          const rsiHandler = (range: { from: number; to: number } | null) => {
            if (isSyncing || !range || !mainChartRef?.current) return;
            isSyncing = true;
            mainChartRef.current.timeScale().setVisibleLogicalRange(range);
            isSyncing = false;
          };

          mainChartRef.current.timeScale().subscribeVisibleLogicalRangeChange(mainHandler);
          chart.timeScale().subscribeVisibleLogicalRangeChange(rsiHandler);

          unsubscribeMain = () => {
            try {
              mainChartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(mainHandler);
            } catch {
              // ignore
            }
          };

          unsubscribeRsi = () => {
            try {
              chart.timeScale().unsubscribeVisibleLogicalRangeChange(rsiHandler);
            } catch {
              // ignore
            }
          };
        } else {
          chart.timeScale().fitContent();
        }

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
      if (unsubscribeMain) unsubscribeMain();
      if (unsubscribeRsi) unsubscribeRsi();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, calculatedRsi, mainChartRef]);

  return (
    <div
      style={{
        borderTop: '1px solid #30363d',
        backgroundColor: '#161b22',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 14px',
          borderBottom: '1px solid #21262d',
          backgroundColor: '#0d1117',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#a855f7' }}>
            RSI ({period})
          </span>
          {lastRsiValue !== null && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color:
                  lastRsiValue >= 70
                    ? '#f85149'
                    : lastRsiValue <= 30
                    ? '#3fb950'
                    : '#e6edf3',
              }}
            >
              {lastRsiValue.toFixed(1)}
            </span>
          )}
        </div>

        {onClose && (
          <button
            onClick={onClose}
            style={{
              backgroundColor: 'transparent',
              color: '#8b949e',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
            title="Hide RSI"
          >
            ✕
          </button>
        )}
      </div>

      <div ref={containerRef} style={{ width: '100%', height: '130px' }} />
    </div>
  );
}

