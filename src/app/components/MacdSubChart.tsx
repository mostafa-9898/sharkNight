'use client';

import React, { useEffect, useRef } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/data/models/candle';
import { calculateMACD, type MACDResult } from '@/indicators/macd';

interface MacdSubChartProps {
  candles: Candle[];
  macdValues?: MACDResult | null;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  onClose?: () => void;
  mainChartRef?: React.MutableRefObject<IChartApi | null>;
}

export default function MacdSubChart({
  candles,
  macdValues,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
  onClose,
  mainChartRef,
}: MacdSubChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const calculatedMacd = React.useMemo(() => {
    if (macdValues && macdValues.macd?.length === candles.length) {
      return macdValues;
    }
    if (candles.length === 0) {
      return { macd: [], signal: [], histogram: [] };
    }
    return calculateMACD(
      candles.map((c) => c.close),
      { fastPeriod, slowPeriod, signalPeriod }
    );
  }, [candles, macdValues, fastPeriod, slowPeriod, signalPeriod]);

  const latestValues = React.useMemo(() => {
    const len = calculatedMacd.macd.length;
    for (let i = len - 1; i >= 0; i--) {
      const m = calculatedMacd.macd[i];
      const s = calculatedMacd.signal[i];
      const h = calculatedMacd.histogram[i];
      if (
        typeof m === 'number' &&
        Number.isFinite(m) &&
        typeof s === 'number' &&
        Number.isFinite(s)
      ) {
        return { macd: m, signal: s, hist: h ?? 0 };
      }
    }
    return null;
  }, [calculatedMacd]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    let isMounted = true;
    let handleResize: (() => void) | null = null;
    let unsubscribeMain: (() => void) | null = null;
    let unsubscribeMacd: (() => void) | null = null;

    import('lightweight-charts').then(
      ({ createChart, LineSeries, HistogramSeries, ColorType }) => {
        if (!isMounted || !containerRef.current) return;

        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: 140,
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
            scaleMargins: { top: 0.15, bottom: 0.15 },
          },
        });

        chartRef.current = chart;

        // Histogram series
        const histSeries = chart.addSeries(HistogramSeries, {
          color: '#2ea043',
          priceFormat: {
            type: 'custom',
            formatter: (p: number) => p.toFixed(2),
          },
        });

        // MACD Line
        const macdSeries = chart.addSeries(LineSeries, {
          color: '#38bdf8',
          lineWidth: 2,
          priceFormat: {
            type: 'custom',
            formatter: (p: number) => p.toFixed(2),
          },
        });

        // Signal Line
        const signalSeries = chart.addSeries(LineSeries, {
          color: '#fbbf24',
          lineWidth: 2,
          priceFormat: {
            type: 'custom',
            formatter: (p: number) => p.toFixed(2),
          },
        });

        // Set Data
        const histData = candles
          .map((c, i) => {
            const val = calculatedMacd.histogram[i];
            return {
              time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
              value: val,
              color: val >= 0 ? '#2ea043' : '#f85149',
            };
          })
          .filter((d) => typeof d.value === 'number' && Number.isFinite(d.value));

        const macdData = candles
          .map((c, i) => ({
            time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
            value: calculatedMacd.macd[i],
          }))
          .filter((d) => typeof d.value === 'number' && Number.isFinite(d.value));

        const signalData = candles
          .map((c, i) => ({
            time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
            value: calculatedMacd.signal[i],
          }))
          .filter((d) => typeof d.value === 'number' && Number.isFinite(d.value));

        histSeries.setData(histData);
        macdSeries.setData(macdData);
        signalSeries.setData(signalData);

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

          const macdSyncHandler = (range: { from: number; to: number } | null) => {
            if (isSyncing || !range || !mainChartRef?.current) return;
            isSyncing = true;
            mainChartRef.current.timeScale().setVisibleLogicalRange(range);
            isSyncing = false;
          };

          mainChartRef.current.timeScale().subscribeVisibleLogicalRangeChange(mainHandler);
          chart.timeScale().subscribeVisibleLogicalRangeChange(macdSyncHandler);

          unsubscribeMain = () => {
            try {
              mainChartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(mainHandler);
            } catch {
              // ignore
            }
          };

          unsubscribeMacd = () => {
            try {
              chart.timeScale().unsubscribeVisibleLogicalRangeChange(macdSyncHandler);
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
      if (unsubscribeMacd) unsubscribeMacd();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, calculatedMacd, mainChartRef]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#facc15' }}>
            MACD ({fastPeriod}, {slowPeriod}, {signalPeriod})
          </span>
          {latestValues && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
              <span style={{ color: '#38bdf8' }}>MACD: {latestValues.macd.toFixed(2)}</span>
              <span style={{ color: '#fbbf24' }}>Signal: {latestValues.signal.toFixed(2)}</span>
              <span
                style={{
                  color: latestValues.hist >= 0 ? '#3fb950' : '#f85149',
                  fontWeight: 600,
                }}
              >
                Hist: {latestValues.hist >= 0 ? '+' : ''}
                {latestValues.hist.toFixed(2)}
              </span>
            </div>
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
            title="Hide MACD"
          >
            ✕
          </button>
        )}
      </div>

      <div ref={containerRef} style={{ width: '100%', height: '140px' }} />
    </div>
  );
}
