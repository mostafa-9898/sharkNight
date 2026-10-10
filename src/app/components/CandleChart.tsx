'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  Time,
  SeriesMarker,
  ISeriesMarkersPluginApi,
} from 'lightweight-charts';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { Trade } from '@/backtest/types';
import type { MACDResult } from '@/indicators/macd';
import RsiSubChart from './RsiSubChart';
import MacdSubChart from './MacdSubChart';

interface CandleChartProps {
  candles: Candle[];
  symbol?: string;
  smaFast?: number[];
  smaSlow?: number[];
  maType?: 'ema' | 'sma';
  fastPeriod?: number;
  slowPeriod?: number;
  rsiValues?: number[];
  rsiPeriod?: number;
  macdValues?: MACDResult | null;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  trades?: Trade[];
  currentInterval?: CandleInterval;
  onIntervalChange?: (interval: CandleInterval) => void;
  loading?: boolean;
}

const TIMEFRAME_OPTIONS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export default function CandleChart({
  candles,
  symbol = 'BTCUSDT',
  smaFast,
  smaSlow,
  maType = 'ema',
  fastPeriod = 10,
  slowPeriod = 30,
  rsiValues,
  rsiPeriod = 14,
  macdValues,
  macdFast = 12,
  macdSlow = 26,
  macdSignal = 9,
  trades = [],
  currentInterval = '15m',
  onIntervalChange,
  loading = false,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const fastLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const slowLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Indicators: OFF by default on initial load!
  const [showFastSMA, setShowFastSMA] = useState(false);
  const [showSlowSMA, setShowSlowSMA] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showSignals, setShowSignals] = useState(false);

  // Indicators Dropdown menu state
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIndicatorsOpen(false);
      }
    };

    if (indicatorsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [indicatorsOpen]);

  // 1. Initialize chart canvas ONCE on mount
  useEffect(() => {
    if (!containerRef.current) return;

    let isMounted = true;
    let handleResize: (() => void) | null = null;

    import('lightweight-charts').then(
      ({ createChart, CandlestickSeries, LineSeries, ColorType }) => {
        if (!isMounted || !containerRef.current) return;

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
          title: `${maType.toUpperCase()} ${fastPeriod}`,
          visible: false,
        });
        fastLineRef.current = fastLine;

        const slowLine = chart.addSeries(LineSeries, {
          color: '#fbbf24',
          lineWidth: 2,
          title: `${maType.toUpperCase()} ${slowPeriod}`,
          visible: false,
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
      if (markersPluginRef.current) {
        try {
          markersPluginRef.current.detach();
        } catch {
          // ignore
        }
        markersPluginRef.current = null;
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

  // 2. ONLY update candles and fitContent when `candles` dataset itself changes (e.g. timeframe change)
  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current || candles.length === 0) {
      return;
    }

    const formattedCandles = candles.map((c) => ({
      time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeriesRef.current.setData(formattedCandles);
    chartRef.current.timeScale().fitContent();
  }, [candles]);

  // 3. Fast MA data update (does NOT fitContent, preserving zoom)
  useEffect(() => {
    if (!fastLineRef.current) return;
    fastLineRef.current.applyOptions({ title: `${maType.toUpperCase()} ${fastPeriod}` });
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
  }, [smaFast, fastPeriod, maType, candles]);

  // 4. Slow MA data update (does NOT fitContent, preserving zoom)
  useEffect(() => {
    if (!slowLineRef.current) return;
    slowLineRef.current.applyOptions({ title: `${maType.toUpperCase()} ${slowPeriod}` });
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
  }, [smaSlow, slowPeriod, maType, candles]);

  // 5. Fast SMA Toggle (instant visibility, zero zoom change)
  useEffect(() => {
    if (fastLineRef.current) {
      fastLineRef.current.applyOptions({ visible: showFastSMA });
    }
  }, [showFastSMA]);

  // 6. Slow SMA Toggle (instant visibility, zero zoom change)
  useEffect(() => {
    if (slowLineRef.current) {
      slowLineRef.current.applyOptions({ visible: showSlowSMA });
    }
  }, [showSlowSMA]);

  // 7. Trade Signals Toggle (instant markers update via setMarkers, zero zoom change)
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    import('lightweight-charts').then(({ createSeriesMarkers }) => {
      if (!candleSeriesRef.current) return;

      if (!markersPluginRef.current) {
        markersPluginRef.current = createSeriesMarkers(candleSeriesRef.current, []);
      }

      if (!showSignals || trades.length === 0) {
        markersPluginRef.current.setMarkers([]);
        return;
      }

      const markers: SeriesMarker<Time>[] = [];
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
      markersPluginRef.current.setMarkers(markers);
    });
  }, [showSignals, trades]);

  // Clear all indicators handler
  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFastSMA(false);
    setShowSlowSMA(false);
    setShowRSI(false);
    setShowMACD(false);
    setShowSignals(false);
  };

  const activeIndicatorsCount = [
    showFastSMA,
    showSlowSMA,
    showRSI,
    showMACD,
    showSignals,
  ].filter(Boolean).length;

  return (
    <div
      style={{
        backgroundColor: '#161b22',
        borderRadius: '8px',
        border: '1px solid #30363d',
        overflow: 'visible',
        position: 'relative',
      }}
    >
      {/* Clean Minimalist Chart Header */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: '#161b22',
          borderTopLeftRadius: '8px',
          borderTopRightRadius: '8px',
        }}
      >
        {/* Left Side: Symbol & Timeframe Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 700, color: '#f0f6fc', fontSize: '15px', letterSpacing: '0.5px' }}>
            {symbol}
          </span>

          {/* Timeframe Dropdown */}
          <select
            value={currentInterval}
            onChange={(e) => onIntervalChange?.(e.target.value as CandleInterval)}
            style={{
              backgroundColor: '#21262d',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {TIMEFRAME_OPTIONS.map((tf) => (
              <option key={tf} value={tf}>
                🕒 {tf}
              </option>
            ))}
          </select>
        </div>

        {/* Right Side: Trade Signals Button & Indicators Dropdown & Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative' }}>
          {/* Quick Toggle: Trade Signals (Executed Backtest Trades) */}
          <button
            onClick={() => setShowSignals((prev) => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: showSignals ? 'rgba(46, 160, 67, 0.15)' : '#21262d',
              border: `1px solid ${showSignals ? '#2ea043' : '#30363d'}`,
              color: showSignals ? '#3fb950' : '#c9d1d9',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="Toggle Backtest Execution Markers on Chart"
          >
            <span>🎯</span>
            <span>Trade Signals</span>
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '8px',
                backgroundColor: showSignals ? '#2ea043' : '#30363d',
                color: showSignals ? '#ffffff' : '#8b949e',
                fontWeight: 700,
              }}
            >
              {showSignals ? 'ON' : 'OFF'}
            </span>
            {trades.length > 0 && (
              <span style={{ fontSize: '10px', color: '#8b949e' }}>
                ({trades.length})
              </span>
            )}
          </button>

          {/* Indicators Dropdown Toggle */}
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setIndicatorsOpen((prev) => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: indicatorsOpen || activeIndicatorsCount > 0 ? '#21262d' : '#161b22',
                border: `1px solid ${activeIndicatorsCount > 0 ? '#38bdf8' : '#30363d'}`,
                color: activeIndicatorsCount > 0 ? '#38bdf8' : '#c9d1d9',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span>📊</span>
              <span>Indicators</span>
              {activeIndicatorsCount > 0 && (
                <span
                  style={{
                    backgroundColor: '#38bdf8',
                    color: '#0d1117',
                    borderRadius: '10px',
                    padding: '1px 6px',
                    fontSize: '10px',
                    fontWeight: 700,
                  }}
                >
                  {activeIndicatorsCount}
                </span>
              )}
              <span style={{ fontSize: '10px', opacity: 0.7 }}>{indicatorsOpen ? '▲' : '▼'}</span>
            </button>

            {/* Dropdown Menu (does NOT close on item clicks, closes on outside click) */}
            {indicatorsOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '8px',
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: '8px',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)',
                  width: '260px',
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  zIndex: 100,
                }}
              >
                {/* 1. Clear All Option */}
                <button
                  onClick={handleClearAll}
                  disabled={activeIndicatorsCount === 0}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: activeIndicatorsCount > 0 ? 'rgba(248, 81, 73, 0.1)' : '#21262d',
                    border: `1px solid ${activeIndicatorsCount > 0 ? 'rgba(248, 81, 73, 0.3)' : '#30363d'}`,
                    color: activeIndicatorsCount > 0 ? '#f85149' : '#6e7681',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: activeIndicatorsCount > 0 ? 'pointer' : 'default',
                    transition: 'all 0.15s ease',
                    marginBottom: '4px',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🗑️</span>
                    <span>Clear All</span>
                  </span>
                  {activeIndicatorsCount > 0 && (
                    <span style={{ fontSize: '11px', opacity: 0.85 }}>({activeIndicatorsCount} active)</span>
                  )}
                </button>

                <div
                  style={{
                    fontSize: '11px',
                    color: '#8b949e',
                    padding: '4px 8px 6px',
                    borderBottom: '1px solid #21262d',
                    marginBottom: '4px',
                  }}
                >
                  Overlay Moving Averages:
                </div>

                {/* Fast MA Item */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor: showFastSMA ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showFastSMA}
                    onChange={(e) => setShowFastSMA(e.target.checked)}
                    style={{ accentColor: '#38bdf8', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#38bdf8',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '13px', color: '#f0f6fc', fontWeight: 500, flexGrow: 1 }}>
                    Fast {maType.toUpperCase()} ({fastPeriod})
                  </span>
                </label>

                {/* Slow MA Item */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor: showSlowSMA ? 'rgba(251, 191, 36, 0.08)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showSlowSMA}
                    onChange={(e) => setShowSlowSMA(e.target.checked)}
                    style={{ accentColor: '#fbbf24', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#fbbf24',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '13px', color: '#f0f6fc', fontWeight: 500, flexGrow: 1 }}>
                    Slow {maType.toUpperCase()} ({slowPeriod})
                  </span>
                </label>

                <div
                  style={{
                    fontSize: '11px',
                    color: '#8b949e',
                    padding: '8px 8px 4px',
                    borderTop: '1px solid #21262d',
                    marginTop: '4px',
                  }}
                >
                  Oscillators & Sub-Panels:
                </div>

                {/* RSI Item */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor: showRSI ? 'rgba(168, 85, 247, 0.08)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showRSI}
                    onChange={(e) => setShowRSI(e.target.checked)}
                    style={{ accentColor: '#a855f7', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#a855f7',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '13px', color: '#f0f6fc', fontWeight: 500, flexGrow: 1 }}>
                    RSI ({rsiPeriod})
                  </span>
                </label>

                {/* MACD Item */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor: showMACD ? 'rgba(234, 179, 8, 0.08)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showMACD}
                    onChange={(e) => setShowMACD(e.target.checked)}
                    style={{ accentColor: '#eab308', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#eab308',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '13px', color: '#f0f6fc', fontWeight: 500, flexGrow: 1 }}>
                    MACD ({macdFast}/{macdSlow}/{macdSignal})
                  </span>
                </label>

                <div
                  style={{
                    fontSize: '11px',
                    color: '#8b949e',
                    padding: '8px 8px 4px',
                    borderTop: '1px solid #21262d',
                    marginTop: '4px',
                  }}
                >
                  Signals & Executions:
                </div>

                {/* Signals Item */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor: showSignals ? 'rgba(46, 160, 67, 0.08)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showSignals}
                    onChange={(e) => setShowSignals(e.target.checked)}
                    style={{ accentColor: '#2ea043', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>🎯</span>
                  <span style={{ fontSize: '13px', color: '#f0f6fc', fontWeight: 500, flexGrow: 1 }}>
                    Trade Signals (Buy/Sell)
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      backgroundColor: '#21262d',
                      color: '#8b949e',
                      padding: '2px 6px',
                      borderRadius: '10px',
                    }}
                  >
                    {trades.length}
                  </span>
                </label>
              </div>
            )}
          </div>

          <span style={{ color: '#8b949e', fontSize: '12px' }}>
            {candles.length.toLocaleString()} candles
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

      {/* RSI Sub-Chart Panel */}
      {showRSI && (
        <RsiSubChart
          candles={candles}
          rsiValues={rsiValues}
          period={rsiPeriod}
          onClose={() => setShowRSI(false)}
          mainChartRef={chartRef}
        />
      )}

      {/* MACD Sub-Chart Panel */}
      {showMACD && (
        <MacdSubChart
          candles={candles}
          macdValues={macdValues}
          fastPeriod={macdFast}
          slowPeriod={macdSlow}
          signalPeriod={macdSignal}
          onClose={() => setShowMACD(false)}
          mainChartRef={chartRef}
        />
      )}

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
