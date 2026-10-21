'use client';

import React, { useEffect, useRef } from 'react';
import type { IChartApi, UTCTimestamp, SeriesMarker, Time } from 'lightweight-charts';
import type { Candle } from '@/data/models/candle';
import { calculateFisherRsi, calculateIftRsi } from '@/indicators/fisher-rsi';

interface FisherSubChartProps {
  candles: Candle[];
  fisherKind: 'fisher' | 'ift';
  rsiPeriod?: number;
  onClose?: () => void;
  mainChartRef?: React.MutableRefObject<IChartApi | null>;
}

export default function FisherSubChart({
  candles,
  fisherKind,
  rsiPeriod = 14,
  onClose,
  mainChartRef,
}: FisherSubChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const calculatedData = React.useMemo(() => {
    if (candles.length === 0) {
      return fisherKind === 'fisher'
        ? { fisher: [] as number[], signal: [] as number[] }
        : ([] as number[]);
    }
    const closes = candles.map((c) => c.close);
    if (fisherKind === 'fisher') {
      return calculateFisherRsi(closes, { rsiPeriod });
    }
    return calculateIftRsi(closes, { rsiPeriod });
  }, [candles, fisherKind, rsiPeriod]);

  const crossMetrics = React.useMemo(() => {
    if (fisherKind !== 'fisher' || candles.length === 0) {
      return {
        bullCrossCount: 0,
        bearCrossCount: 0,
        totalCrosses: 0,
        crossEvents: [] as { idx: number; dir: 'up' | 'down'; timestamp: number }[],
      };
    }
    const data = calculatedData as { fisher: number[]; signal: number[] };
    let bull = 0;
    let bear = 0;
    const events: { idx: number; dir: 'up' | 'down'; timestamp: number }[] = [];
    for (let i = 1; i < candles.length; i++) {
      const fCurr = data.fisher[i];
      const sCurr = data.signal[i];
      const fPrev = data.fisher[i - 1];
      const sPrev = data.signal[i - 1];
      if (
        Number.isFinite(fCurr) &&
        Number.isFinite(sCurr) &&
        Number.isFinite(fPrev) &&
        Number.isFinite(sPrev)
      ) {
        if (fPrev <= sPrev && fCurr > sCurr) {
          bull++;
          events.push({ idx: i, dir: 'up', timestamp: candles[i].timestamp });
        } else if (fPrev >= sPrev && fCurr < sCurr) {
          bear++;
          events.push({ idx: i, dir: 'down', timestamp: candles[i].timestamp });
        }
      }
    }
    return {
      bullCrossCount: bull,
      bearCrossCount: bear,
      totalCrosses: bull + bear,
      crossEvents: events,
    };
  }, [candles, calculatedData, fisherKind]);

  const lastValue = React.useMemo(() => {
    if (fisherKind === 'fisher') {
      const data = calculatedData as { fisher: number[]; signal: number[] };
      let lastFisher: number | null = null;
      let lastSignal: number | null = null;
      for (let i = data.fisher.length - 1; i >= 0; i--) {
        const fv = data.fisher[i];
        const sv = data.signal[i];
        if (lastFisher === null && typeof fv === 'number' && Number.isFinite(fv)) {
          lastFisher = fv;
        }
        if (lastSignal === null && typeof sv === 'number' && Number.isFinite(sv)) {
          lastSignal = sv;
        }
        if (lastFisher !== null && lastSignal !== null) break;
      }
      return { fisher: lastFisher, signal: lastSignal };
    } else {
      const data = calculatedData as number[];
      for (let i = data.length - 1; i >= 0; i--) {
        const val = data[i];
        if (typeof val === 'number' && Number.isFinite(val)) {
          return { ift: val };
        }
      }
      return { ift: null };
    }
  }, [calculatedData, fisherKind]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    let isMounted = true;
    let handleResize: (() => void) | null = null;
    let unsubscribeMain: (() => void) | null = null;
    let unsubscribeFisher: (() => void) | null = null;

    import('lightweight-charts').then(
      ({ createChart, LineSeries, ColorType, LineStyle, createSeriesMarkers }) => {
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

        if (fisherKind === 'fisher') {
          const data = calculatedData as { fisher: number[]; signal: number[] };

          // Fisher line (Cyan)
          const fisherSeries = chart.addSeries(LineSeries, {
            color: '#38bdf8',
            lineWidth: 2,
            title: 'Fisher',
            priceFormat: {
              type: 'custom',
              formatter: (p: number) => p.toFixed(2),
            },
          });

          // Signal line (Orange)
          const signalSeries = chart.addSeries(LineSeries, {
            color: '#f97316',
            lineWidth: 1,
            title: 'Signal',
            priceFormat: {
              type: 'custom',
              formatter: (p: number) => p.toFixed(2),
            },
          });

          // Midline (0)
          fisherSeries.createPriceLine({
            price: 0,
            color: 'rgba(139, 148, 158, 0.25)',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
          });

          // Set Data
          const fisherData: { time: UTCTimestamp; value: number }[] = [];
          const signalData: { time: UTCTimestamp; value: number }[] = [];

          for (let i = 0; i < candles.length; i++) {
            const t = Math.floor(candles[i].timestamp / 1000) as UTCTimestamp;
            const fv = data.fisher[i];
            const sv = data.signal[i];
            if (Number.isFinite(fv)) fisherData.push({ time: t, value: fv });
            if (Number.isFinite(sv)) signalData.push({ time: t, value: sv });
          }

          fisherSeries.setData(fisherData);
          signalSeries.setData(signalData);

          // Crossover markers (▲ Bullish, ▼ Bearish)
          if (crossMetrics.crossEvents.length > 0) {
            const markers: SeriesMarker<Time>[] = crossMetrics.crossEvents.map((evt) => ({
              time: Math.floor(evt.timestamp / 1000) as UTCTimestamp,
              position: evt.dir === 'up' ? ('belowBar' as const) : ('aboveBar' as const),
              color: evt.dir === 'up' ? '#22c55e' : '#ef4444',
              shape: evt.dir === 'up' ? ('arrowUp' as const) : ('arrowDown' as const),
              text: evt.dir === 'up' ? '▲' : '▼',
            }));
            try {
              createSeriesMarkers(fisherSeries, markers);
            } catch (mErr) {
              console.warn('Failed to set Fisher markers:', mErr);
            }
          }
        } else {
          const data = calculatedData as number[];

          // IFT line (Magenta)
          const iftSeries = chart.addSeries(LineSeries, {
            color: '#e879f9',
            lineWidth: 2,
            title: 'IFT',
            priceFormat: {
              type: 'custom',
              formatter: (p: number) => p.toFixed(3),
            },
          });

          // Overbought (+0.5, dashed red)
          iftSeries.createPriceLine({
            price: 0.5,
            color: 'rgba(239, 68, 68, 0.45)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'Overbought (0.5)',
          });

          // Midline (0, dotted gray)
          iftSeries.createPriceLine({
            price: 0,
            color: 'rgba(139, 148, 158, 0.25)',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
          });

          // Oversold (-0.5, dashed green)
          iftSeries.createPriceLine({
            price: -0.5,
            color: 'rgba(34, 197, 94, 0.45)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'Oversold (-0.5)',
          });

          // Set Data
          const iftData: { time: UTCTimestamp; value: number }[] = [];

          for (let i = 0; i < candles.length; i++) {
            const t = Math.floor(candles[i].timestamp / 1000) as UTCTimestamp;
            const v = data[i];
            if (Number.isFinite(v)) iftData.push({ time: t, value: v });
          }

          iftSeries.setData(iftData);
        }

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

          const fisherHandler = (range: { from: number; to: number } | null) => {
            if (isSyncing || !range || !mainChartRef?.current) return;
            isSyncing = true;
            mainChartRef.current.timeScale().setVisibleLogicalRange(range);
            isSyncing = false;
          };

          mainChartRef.current.timeScale().subscribeVisibleLogicalRangeChange(mainHandler);
          chart.timeScale().subscribeVisibleLogicalRangeChange(fisherHandler);

          unsubscribeMain = () => {
            mainChartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(mainHandler);
          };
          unsubscribeFisher = () => {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(fisherHandler);
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
      if (unsubscribeFisher) unsubscribeFisher();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, calculatedData, crossMetrics, fisherKind, rsiPeriod, mainChartRef]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', flexWrap: 'wrap' }}>
          {fisherKind === 'fisher' ? (
            <>
              <span style={{ fontWeight: 600, color: '#f0f6fc' }}>
                🐟 Fisher RSI ({rsiPeriod})
              </span>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  color: '#fbbf24',
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  letterSpacing: '0.02em',
                }}
                title="Reference Pine Script available at docs/reference/fisher-rsi-pinescript.pine.md (golden benchmark dataset pending)"
              >
                UNVERIFIED: not compared to reference
              </span>
              {(lastValue as { fisher: number | null; signal: number | null }).fisher !== null && (
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                  Fisher: {(lastValue as { fisher: number | null; signal: number | null }).fisher!.toFixed(2)}
                </span>
              )}
              {(lastValue as { fisher: number | null; signal: number | null }).signal !== null && (
                <span style={{ color: '#f97316', fontWeight: 600 }}>
                  Signal: {(lastValue as { fisher: number | null; signal: number | null }).signal!.toFixed(2)}
                </span>
              )}
              <span
                style={{ color: '#8b949e', fontSize: '10px' }}
                title={`Crossovers: ${crossMetrics.totalCrosses} (Bullish ▲: ${crossMetrics.bullCrossCount}, Bearish ▼: ${crossMetrics.bearCrossCount})`}
              >
                [Crosses: {crossMetrics.totalCrosses} (▲{crossMetrics.bullCrossCount} ▼{crossMetrics.bearCrossCount})]
              </span>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 600, color: '#f0f6fc' }}>
                📊 IFT-RSI ({rsiPeriod})
              </span>
              {(lastValue as { ift: number | null }).ift !== null && (
                <span
                  style={{
                    fontWeight: 600,
                    color:
                      (lastValue as { ift: number | null }).ift! > 0.5
                        ? '#f85149'
                        : (lastValue as { ift: number | null }).ift! < -0.5
                        ? '#3fb950'
                        : '#e6edf3',
                  }}
                >
                  {(lastValue as { ift: number | null }).ift!.toFixed(3)}
                </span>
              )}
            </>
          )}
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
            title={`Close ${fisherKind === 'fisher' ? 'Fisher RSI' : 'IFT-RSI'} Sub-chart`}
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
