'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import CandleChart from './components/CandleChart';
import EquityChart from './components/EquityChart';
import MetricsCards from './components/MetricsCards';
import TradesTable from './components/TradesTable';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { BacktestMetrics, Trade, TradeMode } from '@/backtest/types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

interface BacktestDiagnostics {
  rsiBuyZoneCandles: number;
  rsiSellZoneCandles: number;
  tkCrossUpEvents: number;
  tkCrossDownEvents: number;
  buySetups: number;
  sellSetups: number;
  executedTradesLong: number;
  executedTradesShort: number;
  executedTradesTotal: number;
}

interface BacktestResultData {
  symbol: string;
  interval: CandleInterval;
  ichimokuTenkan: number;
  ichimokuKijun: number;
  ichimokuSenkouB: number;
  ichimokuDisplacement: number;
  rsiPeriod: number;
  rsiBuyMin: number;
  rsiBuyMax: number;
  rsiSellMin: number;
  rsiSellMax: number;
  rsiLookback: number;
  tradeMode: TradeMode;
  initialBalance: number;
  metrics: BacktestMetrics;
  trades: Trade[];
  equity: number[];
  dataSource?: 'binance' | 'kucoin' | 'cache' | 'synthetic';
  diagnostics?: BacktestDiagnostics;
  indicators: {
    ichimoku?: {
      tenkan: number[];
      kijun: number[];
      senkouA: number[];
      senkouB: number[];
      chikou: number[];
      params: {
        tenkan: number;
        kijun: number;
        senkouB: number;
        displacement: number;
      };
    };
    rsi?: {
      values: number[];
      period: number;
      buyMin: number;
      buyMax: number;
      sellMin: number;
      sellMax: number;
    };
    rsiLookback?: number;
    tradeMode?: TradeMode;
    takeProfitPercent?: number;
    stopLossPercent?: number;
  };
  candles: Candle[];
  totalCandles: number;
  startTime: number | null;
  endTime: number | null;
}

export default function DashboardPage() {
  // --- 1. Top Backtest Configuration Box State ---
  const [btSymbol, setBtSymbol] = useState('BTCUSDT');
  const [btInterval, setBtInterval] = useState<CandleInterval>('15m');
  const [btLimit, setBtLimit] = useState<string>('all');
  const [btInitialBalance, setBtInitialBalance] = useState(10000);
  const [btTradeFeePercent, setBtTradeFeePercent] = useState(0.1);

  // Ichimoku Parameters
  const [ichimokuTenkan, setIchimokuTenkan] = useState(9);
  const [ichimokuKijun, setIchimokuKijun] = useState(26);
  const [ichimokuSenkouB, setIchimokuSenkouB] = useState(52);
  const [ichimokuDisplacement, setIchimokuDisplacement] = useState(26);

  // RSI Parameters
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [rsiBuyMin, setRsiBuyMin] = useState(20);
  const [rsiBuyMax, setRsiBuyMax] = useState(40);
  const [rsiSellMin, setRsiSellMin] = useState(60);
  const [rsiSellMax, setRsiSellMax] = useState(80);
  const [rsiLookback, setRsiLookback] = useState(10);

  // Trade Mode & Risk Management
  const [tradeMode, setTradeMode] = useState<TradeMode>('long-short');
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [takeProfitPercent, setTakeProfitPercent] = useState(10);
  const [stopLossEnabled, setStopLossEnabled] = useState(false);
  const [stopLossPercent, setStopLossPercent] = useState(5);

  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResultData | null>(null);

  // --- 2. Independent Chart Viewer State ---
  const [chartSymbol, setChartSymbol] = useState('BTCUSDT');
  const [chartInterval, setChartInterval] = useState<CandleInterval>('15m');
  const [chartCandles, setChartCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  // In-memory cache for candles to achieve 0ms switching
  const candlesCache = useRef<Map<string, Candle[]>>(new Map());

  // Load candles for the chart view only (does NOT run backtest)
  const loadChartCandles = useCallback(
    async (sym: string, int: CandleInterval) => {
      const cacheKey = `${sym}_${int}`;
      if (candlesCache.current.has(cacheKey)) {
        setChartCandles(candlesCache.current.get(cacheKey)!);
        setChartSymbol(sym);
        setChartInterval(int);
        return;
      }

      setChartLoading(true);
      try {
        const res = await fetch(`/api/candles?symbol=${sym}&interval=${int}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.candles)) {
          candlesCache.current.set(cacheKey, data.candles);
          setChartCandles(data.candles);
          setChartSymbol(sym);
          setChartInterval(int);
        }
      } catch (err) {
        console.error('Failed to load chart candles', err);
      } finally {
        setChartLoading(false);
      }
    },
    []
  );

  // Initial load: Only load candles so user can view the chart right away.
  useEffect(() => {
    loadChartCandles('BTCUSDT', '15m');
  }, [loadChartCandles]);

  // When timeframe is changed on the chart, update chart candles
  const handleChartIntervalChange = (newInterval: CandleInterval) => {
    loadChartCandles(chartSymbol, newInterval);
  };

  // Run Backtest exclusively when user clicks the "Run Backtest ⚡" button
  const runBacktest = useCallback(async () => {
    setBtLoading(true);
    setBtError(null);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: btSymbol,
          interval: btInterval,
          limit: btLimit === 'all' ? undefined : Number(btLimit),
          initialBalance: btInitialBalance,
          tradeFeePercent: btTradeFeePercent,
          ichimokuTenkan,
          ichimokuKijun,
          ichimokuSenkouB,
          ichimokuDisplacement,
          rsiPeriod,
          rsiBuyMin,
          rsiBuyMax,
          rsiSellMin,
          rsiSellMax,
          rsiLookback,
          tradeMode,
          takeProfitPercent: takeProfitEnabled ? takeProfitPercent : undefined,
          stopLossPercent: stopLossEnabled ? stopLossPercent : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to execute backtest');
      }

      const candles: Candle[] = data.candles ?? [];
      const result: BacktestResultData = {
        symbol: btSymbol,
        interval: btInterval,
        dataSource: data.dataSource,
        ichimokuTenkan,
        ichimokuKijun,
        ichimokuSenkouB,
        ichimokuDisplacement,
        rsiPeriod,
        rsiBuyMin,
        rsiBuyMax,
        rsiSellMin,
        rsiSellMax,
        rsiLookback,
        tradeMode,
        initialBalance: btInitialBalance,
        metrics: data.backtest?.metrics,
        trades: data.backtest?.trades ?? [],
        equity: data.backtest?.equity ?? [],
        diagnostics: data.diagnostics,
        indicators: data.indicators,
        candles,
        totalCandles: data.totalCandles ?? candles.length,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
      };

      setBacktestResult(result);

      // Cache candles
      candlesCache.current.set(`${btSymbol}_${btInterval}`, candles);

      // Sync chart to backtest symbol & timeframe
      setChartSymbol(btSymbol);
      setChartInterval(btInterval);
      setChartCandles(candles);
    } catch (err) {
      setBtError(err instanceof Error ? err.message : 'An error occurred during backtest');
    } finally {
      setBtLoading(false);
    }
  }, [
    btSymbol,
    btInterval,
    btLimit,
    btInitialBalance,
    btTradeFeePercent,
    ichimokuTenkan,
    ichimokuKijun,
    ichimokuSenkouB,
    ichimokuDisplacement,
    rsiPeriod,
    rsiBuyMin,
    rsiBuyMax,
    rsiSellMin,
    rsiSellMax,
    rsiLookback,
    tradeMode,
    takeProfitEnabled,
    takeProfitPercent,
    stopLossEnabled,
    stopLossPercent,
  ]);

  const isBacktestMatchingChart =
    backtestResult !== null &&
    backtestResult.symbol === chartSymbol &&
    backtestResult.interval === chartInterval;

  const formatDate = (ts: number | null) => {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div
      style={{
        maxWidth: '1440px',
        margin: '0 auto',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #30363d',
          paddingBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '32px' }}>🤖</span>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#f0f6fc', margin: 0 }}>
              TradeBot — Algorithmic Crypto Terminal
            </h1>
            <span style={{ fontSize: '13px', color: '#8b949e' }}>
              Ichimoku Cloud (TK Cross) + RSI Zone Confluence Engine
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontSize: '12px',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              color: '#38bdf8',
              padding: '6px 14px',
              borderRadius: '20px',
              fontWeight: 600,
            }}
          >
            ⚡ Independent Chart Engine
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: backtestResult ? '#2ea043' : '#8b949e',
                boxShadow: backtestResult ? '0 0 6px #2ea043' : 'none',
              }}
            />
            <span style={{ fontSize: '12px', color: '#8b949e' }}>
              {backtestResult ? 'Simulated' : 'Ready'}
            </span>
          </div>
        </div>
      </header>

      {/* Box 1: Backtesting Control Center (Top Box) */}
      <section
        style={{
          backgroundColor: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: '#f0f6fc',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>⚙️</span>
            <span>Backtest Configuration</span>
          </div>
        </div>

        {/* Row 1: Market & Account Parameters */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'flex-end',
          }}
        >
          {/* Symbol */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Symbol</label>
            <select
              value={btSymbol}
              onChange={(e) => setBtSymbol(e.target.value)}
              style={{
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Timeframe */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Timeframe</label>
            <select
              value={btInterval}
              onChange={(e) => setBtInterval(e.target.value as CandleInterval)}
              style={{
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
              }}
            >
              {INTERVALS.map((int) => (
                <option key={int} value={int}>
                  {int}
                </option>
              ))}
            </select>
          </div>

          {/* Candle Count / Range */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Historical Range</label>
            <select
              value={btLimit}
              onChange={(e) => setBtLimit(e.target.value)}
              style={{
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
              }}
            >
              <option value="all">Full Cached History</option>
              <option value="5000">5,000 Candles</option>
              <option value="2000">2,000 Candles</option>
              <option value="1000">1,000 Candles</option>
              <option value="500">500 Candles</option>
            </select>
          </div>

          {/* Initial Balance */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '120px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Capital ($)</label>
            <input
              type="number"
              step={1000}
              min={100}
              value={btInitialBalance}
              onChange={(e) => setBtInitialBalance(Number(e.target.value))}
              style={{
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
              }}
            />
          </div>

          {/* Fee % */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '90px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Fee (%)</label>
            <input
              type="number"
              step={0.05}
              min={0}
              value={btTradeFeePercent}
              onChange={(e) => setBtTradeFeePercent(Number(e.target.value))}
              style={{
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
              }}
            />
          </div>

          {/* Trade Mode */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Trade Mode</label>
            <select
              value={tradeMode}
              onChange={(e) => setTradeMode(e.target.value as TradeMode)}
              style={{
                backgroundColor: '#0d1117',
                color: '#38bdf8',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <option value="long-short">Long & Short (Default)</option>
              <option value="long-only">Long Only</option>
            </select>
          </div>

          {/* Run Button */}
          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={() => runBacktest()}
              disabled={btLoading}
              style={{
                backgroundColor: btLoading ? '#21262d' : '#238636',
                color: '#ffffff',
                fontWeight: 700,
                padding: '8px 24px',
                borderRadius: '6px',
                fontSize: '14px',
                height: '37px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: btLoading ? 'not-allowed' : 'pointer',
                boxShadow: '0 0 10px rgba(35, 134, 54, 0.3)',
              }}
            >
              {btLoading && (
                <span
                  style={{
                    width: '12px',
                    height: '12px',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#ffffff',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              )}
              {btLoading ? 'Simulating...' : 'Run Backtest ⚡'}
            </button>
          </div>
        </div>

        {/* Section 2: Strategy Settings (Ichimoku & RSI boxes) */}
        <div
          style={{
            borderTop: '1px solid #30363d',
            paddingTop: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#8b949e', letterSpacing: '0.6px' }}>
              ICHIMOKU + RSI STRATEGY SETTINGS
            </span>
          </div>

          {/* Line 1: Ichimoku Settings Box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              backgroundColor: 'rgba(56, 189, 248, 0.05)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: '6px',
              padding: '10px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc' }}>
                ☁️ Ichimoku Kinko Hyo
              </span>
              <span style={{ fontSize: '11px', color: '#8b949e' }}>
                (TK cross: Tenkan vs Kijun)
              </span>
            </div>

            {/* Tenkan */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Tenkan:</label>
              <input
                type="number"
                min={2}
                max={50}
                value={ichimokuTenkan}
                onChange={(e) => setIchimokuTenkan(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#38bdf8',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                }}
              />
            </div>

            {/* Kijun */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Kijun:</label>
              <input
                type="number"
                min={3}
                max={100}
                value={ichimokuKijun}
                onChange={(e) => setIchimokuKijun(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#f97316',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                }}
              />
            </div>

            {/* Senkou B */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Senkou B:</label>
              <input
                type="number"
                min={5}
                max={200}
                value={ichimokuSenkouB}
                onChange={(e) => setIchimokuSenkouB(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#ef4444',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                }}
              />
            </div>

            {/* Displacement */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Displacement:</label>
              <input
                type="number"
                min={1}
                max={100}
                value={ichimokuDisplacement}
                onChange={(e) => setIchimokuDisplacement(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#c084fc',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                }}
              />
            </div>
          </div>

          {/* Line 2: Relative Strength Index (RSI) Box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              backgroundColor: 'rgba(168, 85, 247, 0.05)',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              borderRadius: '6px',
              padding: '10px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc' }}>
                🟣 Relative Strength Index (RSI)
              </span>
            </div>

            {/* RSI Period */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Period:</label>
              <input
                type="number"
                min={2}
                max={50}
                value={rsiPeriod}
                onChange={(e) => setRsiPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                }}
              />
            </div>

            {/* Buy Zone */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Buy Zone:</label>
              <input
                type="number"
                min={1}
                max={99}
                value={rsiBuyMin}
                onChange={(e) => setRsiBuyMin(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#3fb950',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
              <span style={{ color: '#8b949e', fontSize: '12px' }}>-</span>
              <input
                type="number"
                min={1}
                max={99}
                value={rsiBuyMax}
                onChange={(e) => setRsiBuyMax(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#3fb950',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
            </div>

            {/* Sell Zone */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Sell Zone:</label>
              <input
                type="number"
                min={1}
                max={99}
                value={rsiSellMin}
                onChange={(e) => setRsiSellMin(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#f85149',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
              <span style={{ color: '#8b949e', fontSize: '12px' }}>-</span>
              <input
                type="number"
                min={1}
                max={99}
                value={rsiSellMax}
                onChange={(e) => setRsiSellMax(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#f85149',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
            </div>

            {/* Lookback */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>RSI Lookback:</label>
              <input
                type="number"
                min={1}
                max={50}
                value={rsiLookback}
                onChange={(e) => setRsiLookback(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#c084fc',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
              <span style={{ fontSize: '11px', color: '#8b949e' }}>candles</span>
            </div>
          </div>

          {/* Line 3: Risk Management (TP / SL) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              backgroundColor: '#0d1117',
              border: '1px solid #21262d',
              borderRadius: '6px',
              padding: '10px 14px',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc', minWidth: '240px' }}>
              🛡️ Risk Management (Engine-Level Exits)
            </span>

            {/* Take Profit % */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={takeProfitEnabled}
                  onChange={(e) => setTakeProfitEnabled(e.target.checked)}
                  style={{ accentColor: '#2ea043', width: '14px', height: '14px', cursor: 'pointer' }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    color: takeProfitEnabled ? '#e6edf3' : '#8b949e',
                    fontWeight: 600,
                  }}
                >
                  Take Profit:
                </span>
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: takeProfitEnabled ? 1 : 0.4,
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  disabled={!takeProfitEnabled}
                  value={takeProfitPercent}
                  onChange={(e) => setTakeProfitPercent(Number(e.target.value))}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#2ea043',
                    fontWeight: 700,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    width: '65px',
                    cursor: takeProfitEnabled ? 'text' : 'not-allowed',
                  }}
                />
                <span style={{ fontSize: '12px', color: '#8b949e' }}>%</span>
              </div>
            </div>

            {/* Stop Loss % */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={stopLossEnabled}
                  onChange={(e) => setStopLossEnabled(e.target.checked)}
                  style={{ accentColor: '#f85149', width: '14px', height: '14px', cursor: 'pointer' }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    color: stopLossEnabled ? '#e6edf3' : '#8b949e',
                    fontWeight: 600,
                  }}
                >
                  Stop Loss:
                </span>
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: stopLossEnabled ? 1 : 0.4,
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  disabled={!stopLossEnabled}
                  value={stopLossPercent}
                  onChange={(e) => setStopLossPercent(Number(e.target.value))}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#f85149',
                    fontWeight: 700,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    width: '65px',
                    cursor: stopLossEnabled ? 'text' : 'not-allowed',
                  }}
                />
                <span style={{ fontSize: '12px', color: '#8b949e' }}>%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Error Banner */}
      {btError && (
        <div
          style={{
            backgroundColor: 'rgba(248, 81, 73, 0.1)',
            border: '1px solid #f85149',
            borderRadius: '8px',
            padding: '12px 16px',
            color: '#f85149',
            fontSize: '14px',
          }}
        >
          Backtest Error: {btError}
        </div>
      )}

      {/* Chart Section - Always Visible & Independent */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {backtestResult && !isBacktestMatchingChart && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px' }}>
            <span
              style={{
                fontSize: '12px',
                color: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                padding: '3px 10px',
                borderRadius: '4px',
              }}
            >
              Backtest executed on {backtestResult.interval}
            </span>
          </div>
        )}

        <CandleChart
          key={`${chartSymbol}_${chartInterval}`}
          candles={chartCandles}
          symbol={chartSymbol}
          currentInterval={chartInterval}
          onIntervalChange={handleChartIntervalChange}
          loading={chartLoading}
          ichimokuTenkan={ichimokuTenkan}
          ichimokuKijun={ichimokuKijun}
          ichimokuSenkouB={ichimokuSenkouB}
          ichimokuDisplacement={ichimokuDisplacement}
          rsiPeriod={rsiPeriod}
          rsiBuyMin={rsiBuyMin}
          rsiBuyMax={rsiBuyMax}
          rsiSellMin={rsiSellMin}
          rsiSellMax={rsiSellMax}
          trades={isBacktestMatchingChart ? backtestResult?.trades : []}
        />
      </section>

      {/* Backtest Results Area */}
      {backtestResult ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Execution Summary Banner */}
          <div
            style={{
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '8px',
              padding: '12px 18px',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '18px' }}>📊</span>
              <span style={{ fontSize: '13px', color: '#c9d1d9' }}>
                <strong style={{ color: '#f0f6fc', fontWeight: 600 }}>Backtest Results:</strong>{' '}
                <strong style={{ color: '#38bdf8' }}>{backtestResult.symbol}</strong> •{' '}
                <strong style={{ color: '#fbbf24' }}>{backtestResult.interval}</strong> •{' '}
                <strong style={{ color: '#38bdf8' }}>
                  {backtestResult.totalCandles.toLocaleString()}
                </strong>{' '}
                candles
                {backtestResult.startTime && backtestResult.endTime && (
                  <span style={{ color: '#8b949e', marginLeft: '6px' }}>
                    ({formatDate(backtestResult.startTime)} – {formatDate(backtestResult.endTime)})
                  </span>
                )}
                <span style={{ color: '#8b949e', marginLeft: '10px' }}>
                  Strategy:{' '}
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                    Ichimoku ({backtestResult.ichimokuTenkan}/{backtestResult.ichimokuKijun}/
                    {backtestResult.ichimokuSenkouB})
                  </span>{' '}
                  +{' '}
                  <span style={{ color: '#c084fc', fontWeight: 600 }}>
                    RSI ({backtestResult.rsiPeriod})
                  </span>{' '}
                  • Mode:{' '}
                  <span style={{ color: '#f0f6fc', fontWeight: 600 }}>
                    {backtestResult.tradeMode}
                  </span>
                </span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {backtestResult.dataSource === 'synthetic' && (
                <span
                  style={{
                    fontSize: '11px',
                    backgroundColor: 'rgba(248, 81, 73, 0.2)',
                    border: '1px solid #f85149',
                    color: '#f85149',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}
                >
                  ⚠️ SYNTHETIC DATA (SIMULATED)
                </span>
              )}
              {backtestResult.dataSource && backtestResult.dataSource !== 'synthetic' && (
                <span
                  style={{
                    fontSize: '11px',
                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#38bdf8',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  Source: {backtestResult.dataSource}
                </span>
              )}

              <span
                style={{
                  fontSize: '12px',
                  backgroundColor: 'rgba(46, 160, 67, 0.15)',
                  border: '1px solid #2ea043',
                  color: '#3fb950',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontWeight: 600,
                }}
              >
                ✔ Completed
              </span>
            </div>
          </div>

          {/* Metrics Cards (includes Long/Short breakdown) */}
          <MetricsCards
            metrics={backtestResult.metrics}
            initialBalance={backtestResult.initialBalance}
          />

          {/* Signal Funnel (Diagnostics) Card - Always visible after a run */}
          {backtestResult.diagnostics && (
            <div
              style={{
                backgroundColor: '#161b22',
                border: '1px solid #30363d',
                borderRadius: '8px',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#f0f6fc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span>🎯</span>
                  <span>Signal Funnel Diagnostics</span>
                </div>
                <span style={{ fontSize: '11px', color: '#8b949e' }}>
                  Filter funnel explaining trade triggers across the dataset
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>
                    RSI Buy Zone [{backtestResult.rsiBuyMin}-{backtestResult.rsiBuyMax}]
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8', marginTop: '4px' }}>
                    {backtestResult.diagnostics.rsiBuyZoneCandles}{' '}
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>candles</span>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>
                    RSI Sell Zone [{backtestResult.rsiSellMin}-{backtestResult.rsiSellMax}]
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#f85149', marginTop: '4px' }}>
                    {backtestResult.diagnostics.rsiSellZoneCandles}{' '}
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>candles</span>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>
                    TK Cross UP
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#2ea043', marginTop: '4px' }}>
                    {backtestResult.diagnostics.tkCrossUpEvents}{' '}
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>events</span>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>
                    TK Cross DOWN
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#d29922', marginTop: '4px' }}>
                    {backtestResult.diagnostics.tkCrossDownEvents}{' '}
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>events</span>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>
                    BUY Setups
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#2ea043', marginTop: '4px' }}>
                    {backtestResult.diagnostics.buySetups}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>
                    SELL Setups
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#f85149', marginTop: '4px' }}>
                    {backtestResult.diagnostics.sellSetups}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>
                    Executed Trades
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#f0f6fc', marginTop: '4px' }}>
                    {backtestResult.diagnostics.executedTradesTotal}{' '}
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>
                      ({backtestResult.diagnostics.executedTradesLong} Long /{' '}
                      {backtestResult.diagnostics.executedTradesShort} Short)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Equity Curve Chart */}
          {backtestResult.equity.length > 0 && (
            <EquityChart
              candles={backtestResult.candles}
              equity={backtestResult.equity}
              initialBalance={backtestResult.initialBalance}
            />
          )}

          {/* Closed Trades History Table */}
          <TradesTable trades={backtestResult.trades} />
        </section>
      ) : (
        /* Empty / Ready State for Backtest */
        <section
          style={{
            backgroundColor: '#161b22',
            border: '1px dashed #30363d',
            borderRadius: '8px',
            padding: '36px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '32px' }}>⚡</div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#f0f6fc' }}>
            No Backtest Executed Yet
          </div>
          <p
            style={{
              fontSize: '13px',
              color: '#8b949e',
              maxWidth: '520px',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            The chart above is active for technical inspection. Adjust your strategy parameters in
            the configuration panel and click{' '}
            <strong style={{ color: '#2ea043' }}>Run Backtest ⚡</strong> to simulate historical
            performance.
          </p>
        </section>
      )}
    </div>
  );
}
