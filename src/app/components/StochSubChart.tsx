'use client';

import React, { useEffect, useRef } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/data/models/candle';
import { calculateStochastic } from '@/indicators/stochastic';

interface StochSubChartProps {
  candles: Candle[];
  stochKPeriod?: number;
  stochDPeriod?: number;
  stochSmooth?: number;
  oversold?: number;
  overbought?: number;
  onClose?: () => void;
  mainChartRef?: React.MutableRefObject<IChartApi | null>;
}

export default function StochSubChart({
  candles,
  stochKPeriod = 14,
  stochDPeriod = 3,
  stochSmooth = 3,
  oversold = 20,
  overbought = 80,
  onClose,
  mainChartRef,
}: StochSubChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const calculatedStoch = React.useMemo(() => {
    if (candles.length === 0) return { k: [], d: [] };
    return calculateStochastic(candles, {
      kPeriod: stochKPeriod,
      dPeriod: stochDPeriod,
      smooth: stochSmooth,
    });
  }, [candles, stochKPeriod, stochDPeriod, stochSmooth]);

  const lastValues = React.useMemo(() => {
    let lastK: number | null = null;
    let lastD: number | null = null;
    for (let i = calculatedStoch.k.length - 1; i >= 0; i--) {
      const kv = calculatedStoch.k[i];
      const dv = calculatedStoch.d[i];
      if (lastK === null && typeof kv === 'number' && Number.isFinite(kv)) {
        lastK = kv;
      }
      if (lastD === null && typeof dv === 'number' && Number.isFinite(dv)) {
        lastD = dv;
      }
      if (lastK !== null && lastD !== null) break;
    }
    return { k: lastK, d: lastD };
  }, [calculatedStoch]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    let isMounted = true;
    let handleResize: (() => void) | null = null;
    let unsubscribeMain: (() => void) | null = null;
    let unsubscribeStoch: (() => void) | null = null;

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

        // %K Line (Blue)
        const kSeries = chart.addSeries(LineSeries, {
          color: '#38bdf8',
          lineWidth: 2,
          title: '%K',
          priceFormat: {
            type: 'custom',
            formatter: (p: number) => p.toFixed(1),
          },
        });

        // %D Line (Orange)
        const dSeries = chart.addSeries(LineSeries, {
          color: '#f97316',
          lineWidth: 1,
          title: '%D',
          priceFormat: {
            type: 'custom',
            formatter: (p: number) => p.toFixed(1),
          },
        });

        // Overbought line (80)
        kSeries.createPriceLine({
          price: overbought,
          color: 'rgba(239, 68, 68, 0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Overbought (${overbought})`,
        });

        // Midline (50)
        kSeries.createPriceLine({
          price: 50,
          color: 'rgba(139, 148, 158, 0.25)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
        });

        // Oversold line (20)
        kSeries.createPriceLine({
          price: oversold,
          color: 'rgba(34, 197, 94, 0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Oversold (${oversold})`,
        });

        // Set Data
        const kData: { time: UTCTimestamp; value: number }[] = [];
        const dData: { time: UTCTimestamp; value: number }[] = [];

        for (let i = 0; i < candles.length; i++) {
          const t = Math.floor(candles[i].timestamp / 1000) as UTCTimestamp;
          const kv = calculatedStoch.k[i];
          const dv = calculatedStoch.d[i];
          if (Number.isFinite(kv)) kData.push({ time: t, value: kv });
          if (Number.isFinite(dv)) dData.push({ time: t, value: dv });
        }

        kSeries.setData(kData);
        dSeries.setData(dData);

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

          const stochHandler = (range: { from: number; to: number } | null) => {
            if (isSyncing || !range || !mainChartRef?.current) return;
            isSyncing = true;
            mainChartRef.current.timeScale().setVisibleLogicalRange(range);
            isSyncing = false;
          };

          mainChartRef.current.timeScale().subscribeVisibleLogicalRangeChange(mainHandler);
          chart.timeScale().subscribeVisibleLogicalRangeChange(stochHandler);

          unsubscribeMain = () => {
            mainChartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(mainHandler);
          };
          unsubscribeStoch = () => {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(stochHandler);
          };
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
      if (unsubscribeStoch) unsubscribeStoch();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, calculatedStoch, stochKPeriod, stochDPeriod, oversold, overbought, mainChartRef]);

  return (
    <div
      style={{
        borderTop: '1px solid #30363d',
        backgroundColor: '#161b22',
        position: 'relative',
        padding: '6px 12px 10px 12px',
      }}
    >
      {/* Sub-Chart Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
          padding: '0 4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
          <span style={{ fontWeight: 600, color: '#f0f6fc' }}>
            🌊 Stochastic ({stochKPeriod}, {stochDPeriod}, {stochSmooth})
          </span>
          {lastValues.k !== null && (
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>
              %K: {lastValues.k.toFixed(1)}
            </span>
          )}
          {lastValues.d !== null && (
            <span style={{ color: '#f97316', fontWeight: 600 }}>
              %D: {lastValues.d.toFixed(1)}
            </span>
          )}
          <span style={{ color: '#8b949e', fontSize: '10px' }}>
            [Oversold: {oversold} | Overbought: {overbought}]
          </span>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 6px',
              borderRadius: '4px',
              lineHeight: 1,
            }}
            title="Close Stochastic Sub-chart"
          >
            ✕
          </button>
        )}
      </div>

      {/* Lightweight Chart Container */}
      <div ref={containerRef} style={{ width: '100%', height: '130px' }} />
    </div>
  );
}

