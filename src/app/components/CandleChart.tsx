'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  Time,
  SeriesMarker,
  ISeriesMarkersPluginApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { Trade } from '@/backtest/types';
import { calculateIchimoku } from '@/indicators/ichimoku';
import { calculateRSI } from '@/indicators/rsi';
import RsiSubChart from './RsiSubChart';

interface CandleChartProps {
  candles: Candle[];
  symbol?: string;
  currentInterval?: CandleInterval;
  onIntervalChange?: (interval: CandleInterval) => void;
  loading?: boolean;
  // Ichimoku params (from dashboard)
  ichimokuTenkan?: number;
  ichimokuKijun?: number;
  ichimokuSenkouB?: number;
  ichimokuDisplacement?: number;
  // RSI params (from dashboard)
  rsiPeriod?: number;
  rsiBuyMin?: number;
  rsiBuyMax?: number;
  rsiSellMin?: number;
  rsiSellMax?: number;
  // Backtest executed trades
  trades?: Trade[];
}

const TIMEFRAME_OPTIONS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

function getIntervalSec(interval: CandleInterval): number {
  switch (interval) {
    case '1m':
      return 60;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '30m':
      return 1800;
    case '1h':
      return 3600;
    case '4h':
      return 14400;
    case '1d':
      return 86400;
    default:
      return 3600;
  }
}

/**
 * Custom Series Primitive to draw the Ichimoku Cloud fill between Senkou Span A and Senkou Span B.
 * Green when Senkou A > Senkou B, Red when Senkou B > Senkou A.
 */
class IchimokuCloudPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<'Candlestick', Time> | null = null;
  private _points: { time: UTCTimestamp; a: number; b: number }[] = [];
  private _requestUpdate?: () => void;

  setData(points: { time: UTCTimestamp; a: number; b: number }[]) {
    this._points = points;
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._chart = param.chart;
    this._series = param.series as ISeriesApi<'Candlestick', Time>;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  updateAllViews() {}

  paneViews() {
    return [
      {
        renderer: () => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          draw: (target: any) => {
            if (!this._chart || !this._series || this._points.length < 2) return;
            try {
              target.useMediaCoordinateSpace((scope: { context: CanvasRenderingContext2D }) => {
                const ctx = scope.context;
                const timeScale = this._chart!.timeScale();

                for (let i = 0; i < this._points.length - 1; i++) {
                  const p1 = this._points[i];
                  const p2 = this._points[i + 1];

                  const x1 = timeScale.timeToCoordinate(p1.time);
                  const x2 = timeScale.timeToCoordinate(p2.time);
                  const yA1 = this._series!.priceToCoordinate(p1.a);
                  const yA2 = this._series!.priceToCoordinate(p2.a);
                  const yB1 = this._series!.priceToCoordinate(p1.b);
                  const yB2 = this._series!.priceToCoordinate(p2.b);

                  if (
                    x1 === null ||
                    x2 === null ||
                    yA1 === null ||
                    yA2 === null ||
                    yB1 === null ||
                    yB2 === null
                  ) {
                    continue;
                  }

                  ctx.beginPath();
                  ctx.moveTo(x1, yA1);
                  ctx.lineTo(x2, yA2);
                  ctx.lineTo(x2, yB2);
                  ctx.lineTo(x1, yB1);
                  ctx.closePath();

                  const isBullish = (p1.a + p2.a) / 2 >= (p1.b + p2.b) / 2;
                  ctx.fillStyle = isBullish
                    ? 'rgba(34, 197, 94, 0.22)'
                    : 'rgba(239, 68, 68, 0.22)';
                  ctx.fill();
                }
              });
            } catch {
              // Graceful fallback if primitive canvas access is unsupported
            }
          },
        }),
      },
    ];
  }
}

export default function CandleChart({
  candles,
  symbol = 'BTCUSDT',
  currentInterval = '15m',
  onIntervalChange,
  loading = false,
  ichimokuTenkan = 9,
  ichimokuKijun = 26,
  ichimokuSenkouB = 52,
  ichimokuDisplacement = 26,
  rsiPeriod = 14,
  rsiBuyMin = 20,
  rsiBuyMax = 40,
  rsiSellMin = 60,
  rsiSellMax = 80,
  trades = [],
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Ichimoku Line Series
  const tenkanLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const kijunLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const chikouLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const senkouALineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const senkouBLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cloudPrimitiveRef = useRef<IchimokuCloudPrimitive | null>(null);

  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const [isChartReady, setIsChartReady] = useState(false);

  // Indicators: OFF by default on initial load!
  const [showIchimoku, setShowIchimoku] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
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

  // Client-side Indicator Calculations from loaded chart candles
  const ichimokuData = useMemo(() => {
    if (candles.length === 0) return null;
    try {
      return calculateIchimoku(candles, {
        tenkan: ichimokuTenkan,
        kijun: ichimokuKijun,
        senkouB: ichimokuSenkouB,
        displacement: ichimokuDisplacement,
      });
    } catch {
      return null;
    }
  }, [candles, ichimokuTenkan, ichimokuKijun, ichimokuSenkouB, ichimokuDisplacement]);

  const rsiValues = useMemo(() => {
    if (candles.length === 0) return [];
    try {
      const closes = candles.map((c) => c.close);
      return calculateRSI(closes, rsiPeriod);
    } catch {
      return [];
    }
  }, [candles, rsiPeriod]);

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

        // Attach Ichimoku Cloud Primitive for custom canvas fill
        const cloudPrimitive = new IchimokuCloudPrimitive();
        cloudPrimitiveRef.current = cloudPrimitive;
        try {
          candleSeries.attachPrimitive(cloudPrimitive);
        } catch {
          // ignore
        }

        // Senkou Span A & B lines (thin lines + boundary)
        senkouALineRef.current = chart.addSeries(LineSeries, {
          color: '#22c55e',
          lineWidth: 1,
          title: 'Senkou A',
          visible: showIchimoku,
        });

        senkouBLineRef.current = chart.addSeries(LineSeries, {
          color: '#ef4444',
          lineWidth: 1,
          title: 'Senkou B',
          visible: showIchimoku,
        });

        // Tenkan-sen (Conversion Line, Blue)
        tenkanLineRef.current = chart.addSeries(LineSeries, {
          color: '#38bdf8',
          lineWidth: 2,
          title: `Tenkan (${ichimokuTenkan})`,
          visible: showIchimoku,
        });

        // Kijun-sen (Base Line, Red/Orange)
        kijunLineRef.current = chart.addSeries(LineSeries, {
          color: '#f97316',
          lineWidth: 2,
          title: `Kijun (${ichimokuKijun})`,
          visible: showIchimoku,
        });

        // Chikou Span (Lagging Span, Muted Purple)
        chikouLineRef.current = chart.addSeries(LineSeries, {
          color: '#c084fc',
          lineWidth: 1,
          title: 'Chikou',
          visible: showIchimoku,
        });

        handleResize = () => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: containerRef.current.clientWidth,
            });
          }
        };

        window.addEventListener('resize', handleResize);
        setIsChartReady(true);
      }
    );

    return () => {
      isMounted = false;
      setIsChartReady(false);
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
        tenkanLineRef.current = null;
        kijunLineRef.current = null;
        chikouLineRef.current = null;
        senkouALineRef.current = null;
        senkouBLineRef.current = null;
        cloudPrimitiveRef.current = null;
      }
    };
  }, []); // Run ONCE on mount

  // 2. Coordinated update when `candles` dataset changes (timeframe or symbol switch)
  useEffect(() => {
    if (!isChartReady || !candleSeriesRef.current || !chartRef.current || candles.length === 0) {
      return;
    }

    const formattedCandles: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    const candleTimes: UTCTimestamp[] = [];
    let lastTime: number | null = null;

    for (const c of candles) {
      if (typeof c.timestamp !== 'number' || !Number.isFinite(c.timestamp)) continue;
      const t = Math.floor(c.timestamp / 1000) as UTCTimestamp;
      if (lastTime === null || t > lastTime) {
        formattedCandles.push({
          time: t,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        });
        candleTimes.push(t);
        lastTime = t;
      }
    }

    // Reset markers and secondary series before loading new timeframe
    if (markersPluginRef.current) {
      try {
        markersPluginRef.current.setMarkers([]);
      } catch {
        // ignore
      }
    }

    // Set candle data
    try {
      candleSeriesRef.current.setData(formattedCandles);
    } catch (err) {
      console.warn('Failed to set candle data on chart:', err);
    }

    // Calculate future timestamps for Ichimoku Senkou forward displacement
    const intervalSec = getIntervalSec(currentInterval);
    const lastSec = candleTimes[candleTimes.length - 1] ?? 0;
    const allTimes: UTCTimestamp[] = [...candleTimes];
    for (let k = 1; k <= ichimokuDisplacement; k++) {
      allTimes.push((lastSec + k * intervalSec) as UTCTimestamp);
    }

    // Update Ichimoku lines if data is available
    if (ichimokuData) {
      const tenkanPts = candleTimes
        .map((t, i) => ({ time: t, value: ichimokuData.tenkan[i] }))
        .filter((p) => Number.isFinite(p.value));
      tenkanLineRef.current?.setData(tenkanPts);

      const kijunPts = candleTimes
        .map((t, i) => ({ time: t, value: ichimokuData.kijun[i] }))
        .filter((p) => Number.isFinite(p.value));
      kijunLineRef.current?.setData(kijunPts);

      const chikouPts = candleTimes
        .map((t, i) => ({ time: t, value: ichimokuData.chikou[i] }))
        .filter((p) => Number.isFinite(p.value));
      chikouLineRef.current?.setData(chikouPts);

      const senkouAPts = allTimes
        .map((t, i) => ({ time: t, value: ichimokuData.senkouA[i] }))
        .filter((p) => Number.isFinite(p.value));
      senkouALineRef.current?.setData(senkouAPts);

      const senkouBPts = allTimes
        .map((t, i) => ({ time: t, value: ichimokuData.senkouB[i] }))
        .filter((p) => Number.isFinite(p.value));
      senkouBLineRef.current?.setData(senkouBPts);

      // Cloud primitive data
      const cloudPts: { time: UTCTimestamp; a: number; b: number }[] = [];
      for (let i = 0; i < allTimes.length; i++) {
        const valA = ichimokuData.senkouA[i];
        const valB = ichimokuData.senkouB[i];
        if (Number.isFinite(valA) && Number.isFinite(valB)) {
          cloudPts.push({ time: allTimes[i], a: valA, b: valB });
        }
      }
      cloudPrimitiveRef.current?.setData(cloudPts);
    }

    // Fit content only when changing dataset/timeframe
    try {
      chartRef.current.timeScale().fitContent();
    } catch (err) {
      console.warn('Failed to fit content:', err);
    }
  }, [candles, isChartReady, currentInterval, ichimokuData, ichimokuDisplacement]);

  // 3. Ichimoku Visibility Toggle (instant, zero zoom change)
  useEffect(() => {
    tenkanLineRef.current?.applyOptions({ visible: showIchimoku });
    kijunLineRef.current?.applyOptions({ visible: showIchimoku });
    chikouLineRef.current?.applyOptions({ visible: showIchimoku });
    senkouALineRef.current?.applyOptions({ visible: showIchimoku });
    senkouBLineRef.current?.applyOptions({ visible: showIchimoku });

    if (!showIchimoku) {
      cloudPrimitiveRef.current?.setData([]);
    } else if (ichimokuData && candles.length > 0) {
      const intervalSec = getIntervalSec(currentInterval);
      const candleTimes = candles.map((c) => Math.floor(c.timestamp / 1000) as UTCTimestamp);
      const lastSec = candleTimes[candleTimes.length - 1] ?? 0;
      const allTimes: UTCTimestamp[] = [...candleTimes];
      for (let k = 1; k <= ichimokuDisplacement; k++) {
        allTimes.push((lastSec + k * intervalSec) as UTCTimestamp);
      }
      const cloudPts: { time: UTCTimestamp; a: number; b: number }[] = [];
      for (let i = 0; i < allTimes.length; i++) {
        const valA = ichimokuData.senkouA[i];
        const valB = ichimokuData.senkouB[i];
        if (Number.isFinite(valA) && Number.isFinite(valB)) {
          cloudPts.push({ time: allTimes[i], a: valA, b: valB });
        }
      }
      cloudPrimitiveRef.current?.setData(cloudPts);
    }
  }, [showIchimoku, ichimokuData, candles, currentInterval, ichimokuDisplacement]);

  // 4. Trade Signals Markers Toggle (side-aware markers, zero zoom change)
  useEffect(() => {
    if (!isChartReady || !candleSeriesRef.current) return;

    let isMounted = true;
    import('lightweight-charts').then(({ createSeriesMarkers }) => {
      if (!isMounted || !candleSeriesRef.current) return;

      if (!markersPluginRef.current) {
        try {
          markersPluginRef.current = createSeriesMarkers(candleSeriesRef.current, []);
        } catch (err) {
          console.warn('Failed to initialize series markers plugin:', err);
          return;
        }
      }

      if (!showSignals || trades.length === 0 || candles.length === 0) {
        try {
          markersPluginRef.current.setMarkers([]);
        } catch (err) {
          console.warn('Failed to clear markers:', err);
        }
        return;
      }

      const candleTimeSet = new Set<number>();
      for (const c of candles) {
        if (typeof c.timestamp === 'number' && Number.isFinite(c.timestamp)) {
          candleTimeSet.add(Math.floor(c.timestamp / 1000));
        }
      }

      const markers: SeriesMarker<Time>[] = [];

      trades.forEach((trade, idx) => {
        const tradeNum = idx + 1;
        const isLong = trade.side === 'long';

        // Entry Marker
        if (trade.entryTime) {
          const entrySec = Math.floor(trade.entryTime / 1000) as UTCTimestamp;
          if (candleTimeSet.has(entrySec)) {
            if (isLong) {
              // Long entry = BUY arrow up below the bar with trade number
              markers.push({
                time: entrySec,
                position: 'belowBar',
                color: '#2ea043',
                shape: 'arrowUp',
                text: `#${tradeNum} BUY @ $${trade.entryPrice.toLocaleString()}`,
              });
            } else {
              // Short entry = SELL arrow down above the bar with trade number
              markers.push({
                time: entrySec,
                position: 'aboveBar',
                color: '#eab308',
                shape: 'arrowDown',
                text: `#${tradeNum} SHORT @ $${trade.entryPrice.toLocaleString()}`,
              });
            }
          }
        }

        // Exit Marker
        if (trade.exitTime) {
          const exitSec = Math.floor(trade.exitTime / 1000) as UTCTimestamp;
          if (candleTimeSet.has(exitSec)) {
            const isWin = trade.pnl > 0;
            const pnlStr = `${isWin ? '+' : ''}${trade.pnlPercent.toFixed(1)}%`;

            if (isLong) {
              // Long exit = arrow down above the bar with trade number and PnL%
              markers.push({
                time: exitSec,
                position: 'aboveBar',
                color: isWin ? '#38bdf8' : '#f85149',
                shape: 'arrowDown',
                text: `#${tradeNum} EXIT (${pnlStr}) [${trade.exitReason}]`,
              });
            } else {
              // Short exit = arrow up below the bar with trade number and PnL%
              markers.push({
                time: exitSec,
                position: 'belowBar',
                color: isWin ? '#38bdf8' : '#f85149',
                shape: 'arrowUp',
                text: `#${tradeNum} EXIT (${pnlStr}) [${trade.exitReason}]`,
              });
            }
          }
        }
      });

      // Sort markers chronologically; if duplicate timestamps occur (reversals), both remain in array
      markers.sort((a, b) => Number(a.time) - Number(b.time));

      try {
        markersPluginRef.current.setMarkers(markers);
      } catch (err) {
        console.warn('Failed to set markers on chart:', err);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [showSignals, trades, candles, isChartReady]);

  // Clear all indicators handler
  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowIchimoku(false);
    setShowRSI(false);
    setShowSignals(false);
  };

  const activeIndicatorsCount = [showIchimoku, showRSI, showSignals].filter(Boolean).length;

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
      {/* Chart Header */}
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
          <span
            style={{ fontWeight: 700, color: '#f0f6fc', fontSize: '15px', letterSpacing: '0.5px' }}
          >
            {symbol}
          </span>

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

        {/* Right Side: Trade Signals & Indicators Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative' }}>
          {/* Quick Toggle: Trade Signals */}
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
                borderRadius: '10px',
                backgroundColor: showSignals ? 'rgba(46, 160, 67, 0.3)' : '#30363d',
                color: showSignals ? '#3fb950' : '#8b949e',
              }}
            >
              {trades.length}
            </span>
          </button>

          {/* Indicators Dropdown Menu */}
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setIndicatorsOpen((prev) => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: activeIndicatorsCount > 0 ? 'rgba(56, 189, 248, 0.15)' : '#21262d',
                border: `1px solid ${activeIndicatorsCount > 0 ? '#38bdf8' : '#30363d'}`,
                color: activeIndicatorsCount > 0 ? '#38bdf8' : '#c9d1d9',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span>📈</span>
              <span>Indicators</span>
              {activeIndicatorsCount > 0 && (
                <span
                  style={{
                    backgroundColor: '#38bdf8',
                    color: '#0d1117',
                    borderRadius: '50%',
                    width: '16px',
                    height: '16px',
                    fontSize: '10px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {activeIndicatorsCount}
                </span>
              )}
              <span style={{ fontSize: '10px' }}>{indicatorsOpen ? '▲' : '▼'}</span>
            </button>

            {/* Dropdown Menu Popup */}
            {indicatorsOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '6px',
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: '8px',
                  padding: '12px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  minWidth: '280px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #30363d',
                    paddingBottom: '8px',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#f0f6fc' }}>
                    Chart Indicators
                  </span>
                  {activeIndicatorsCount > 0 && (
                    <button
                      onClick={handleClearAll}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#f85149',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {/* Option 1: Ichimoku Cloud (9/26/52) */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: showIchimoku ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={showIchimoku}
                      onChange={(e) => setShowIchimoku(e.target.checked)}
                      style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '13px', color: '#e6edf3', fontWeight: 500 }}>
                      ☁️ Ichimoku Cloud ({ichimokuTenkan}/{ichimokuKijun}/{ichimokuSenkouB})
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#8b949e' }}>TK/Cloud</span>
                </label>

                {/* Option 2: RSI */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: showRSI ? 'rgba(168, 85, 247, 0.08)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={showRSI}
                      onChange={(e) => setShowRSI(e.target.checked)}
                      style={{ accentColor: '#a855f7', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '13px', color: '#e6edf3', fontWeight: 500 }}>
                      🟣 Relative Strength Index (RSI {rsiPeriod})
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#8b949e' }}>Sub-chart</span>
                </label>

                {/* Option 3: Trade Signals */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: showSignals ? 'rgba(46, 160, 67, 0.08)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={showSignals}
                      onChange={(e) => setShowSignals(e.target.checked)}
                      style={{ accentColor: '#2ea043', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '13px', color: '#e6edf3', fontWeight: 500 }}>
                      🎯 Trade Signals
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#8b949e' }}>Markers</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Candlestick Chart Canvas */}
      <div style={{ position: 'relative', width: '100%', height: '480px' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Loading Spinner Overlay */}
        {loading && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(22, 27, 34, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
                animation: 'spin 1s linear infinite',
              }}
            />
          </div>
        )}
      </div>

      {/* RSI Sub-Chart (Synchronized time-axis) */}
      {showRSI && (
        <RsiSubChart
          candles={candles}
          rsiValues={rsiValues}
          rsiPeriod={rsiPeriod}
          rsiBuyMin={rsiBuyMin}
          rsiBuyMax={rsiBuyMax}
          rsiSellMin={rsiSellMin}
          rsiSellMax={rsiSellMax}
        />
      )}
    </div>
  );
}
