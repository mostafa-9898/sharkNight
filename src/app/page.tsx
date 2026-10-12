'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import CandleChart from './components/CandleChart';
import EquityChart from './components/EquityChart';
import MetricsCards from './components/MetricsCards';
import TradesTable from './components/TradesTable';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { BacktestMetrics, Trade } from '@/backtest/types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

interface BacktestResultData {
  symbol: string;
  interval: CandleInterval;
  maEnabled: boolean;
  maType: 'ema' | 'sma';
  fastPeriod: number;
  slowPeriod: number;
  rsiEnabled: boolean;
  macdEnabled: boolean;
  initialBalance: number;
  metrics: BacktestMetrics;
  trades: Trade[];
  equity: number[];
  dataSource?: 'binance' | 'kucoin' | 'cache' | 'synthetic';
  indicators: {
    smaFast: number[];
    smaSlow: number[];
    rsi?: number[];
    rsiBuyMin?: number;
    rsiBuyMax?: number;
    rsiSellMin?: number;
    rsiSellMax?: number;
    macd?: { macd: number[]; signal: number[]; histogram: number[] };
    confirmationWindow?: number;
    rsiLookback?: number;
    exitMode?: 'mirror' | 'emaCross' | 'macdCross';
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

  // Indicators State (Strategy 1 defaults: EMA + RSI + MACD)
  const [maEnabled, setMaEnabled] = useState(true);
  const [maType, setMaType] = useState<'ema' | 'sma'>('ema');
  const [btFastPeriod, setBtFastPeriod] = useState(10);
  const [btSlowPeriod, setBtSlowPeriod] = useState(30);

  const [rsiEnabled, setRsiEnabled] = useState(true);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [rsiBuyMin, setRsiBuyMin] = useState(25);
  const [rsiBuyMax, setRsiBuyMax] = useState(35);
  const [rsiSellMin, setRsiSellMin] = useState(65);
  const [rsiSellMax, setRsiSellMax] = useState(75);
  const [rsiLookback, setRsiLookback] = useState(10);

  const [macdEnabled, setMacdEnabled] = useState(true);
  const [macdFastPeriod, setMacdFastPeriod] = useState(12);
  const [macdSlowPeriod, setMacdSlowPeriod] = useState(26);
  const [macdSignalPeriod, setMacdSignalPeriod] = useState(9);

  const [confirmationWindow, setConfirmationWindow] = useState(6);
  const [exitMode, setExitMode] = useState<'mirror' | 'emaCross' | 'macdCross'>('mirror');
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [takeProfitPercent, setTakeProfitPercent] = useState(10);
  const [stopLossEnabled, setStopLossEnabled] = useState(false);
  const [stopLossPercent, setStopLossPercent] = useState(5);

  const hasAtLeastOneIndicator = maEnabled || rsiEnabled || macdEnabled;

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

  // Initial load: Only load candles so user can view the chart right away. NO backtest is triggered!
  useEffect(() => {
    loadChartCandles('BTCUSDT', '15m');
  }, [loadChartCandles]);

  // When timeframe is changed on the chart, ONLY update the chart candles!
  const handleChartIntervalChange = (newInterval: CandleInterval) => {
    loadChartCandles(chartSymbol, newInterval);
  };

  // Run Backtest exclusively when user clicks the "Run Backtest ⚡" button
  const runBacktest = useCallback(async () => {
    if (!hasAtLeastOneIndicator) {
      setBtError('Please enable at least one indicator to execute backtest.');
      return;
    }

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
          maEnabled,
          maType,
          fastPeriod: btFastPeriod,
          slowPeriod: btSlowPeriod,
          rsiEnabled,
          rsiPeriod,
          rsiBuyMin,
          rsiBuyMax,
          rsiSellMin,
          rsiSellMax,
          rsiLookback,
          macdEnabled,
          macdFastPeriod,
          macdSlowPeriod,
          macdSignalPeriod,
          exitMode,
          takeProfitPercent: takeProfitEnabled ? takeProfitPercent : undefined,
          stopLossPercent: stopLossEnabled ? stopLossPercent : undefined,
          confirmationWindow,
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
        maEnabled,
        maType,
        fastPeriod: btFastPeriod,
        slowPeriod: btSlowPeriod,
        rsiEnabled,
        macdEnabled,
        initialBalance: btInitialBalance,
        metrics: data.backtest?.metrics,
        trades: data.backtest?.trades ?? [],
        equity: data.backtest?.equity ?? [],
        indicators: {
          smaFast: data.indicators?.smaFast ?? [],
          smaSlow: data.indicators?.smaSlow ?? [],
          rsi: data.indicators?.rsi ?? [],
          rsiBuyMin: data.indicators?.rsiBuyMin ?? rsiBuyMin,
          rsiBuyMax: data.indicators?.rsiBuyMax ?? rsiBuyMax,
          rsiSellMin: data.indicators?.rsiSellMin ?? rsiSellMin,
          rsiSellMax: data.indicators?.rsiSellMax ?? rsiSellMax,
          rsiLookback: data.indicators?.rsiLookback ?? rsiLookback,
          macd: data.indicators?.macd ?? null,
          confirmationWindow: data.indicators?.confirmationWindow ?? confirmationWindow,
          exitMode: data.indicators?.exitMode ?? exitMode,
          takeProfitPercent: data.indicators?.takeProfitPercent,
          stopLossPercent: data.indicators?.stopLossPercent,
        },
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
    maEnabled,
    maType,
    btFastPeriod,
    btSlowPeriod,
    rsiEnabled,
    rsiPeriod,
    rsiBuyMin,
    rsiBuyMax,
    rsiSellMin,
    rsiSellMax,
    rsiLookback,
    macdEnabled,
    macdFastPeriod,
    macdSlowPeriod,
    macdSignalPeriod,
    exitMode,
    takeProfitEnabled,
    takeProfitPercent,
    stopLossEnabled,
    stopLossPercent,
    confirmationWindow,
    hasAtLeastOneIndicator,
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
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              <option value="all">Full 1-Year</option>
              <option value="1000">1,000 Candles</option>
              <option value="500">500 Candles</option>
              <option value="300">300 Candles</option>
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

          {/* Run Button */}
          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={() => runBacktest()}
              disabled={btLoading || !hasAtLeastOneIndicator}
              style={{
                backgroundColor: btLoading || !hasAtLeastOneIndicator ? '#21262d' : '#238636',
                color: '#ffffff',
                fontWeight: 700,
                padding: '8px 24px',
                borderRadius: '6px',
                fontSize: '14px',
                height: '37px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: btLoading || !hasAtLeastOneIndicator ? 'not-allowed' : 'pointer',
                boxShadow: hasAtLeastOneIndicator ? '0 0 10px rgba(35, 134, 54, 0.3)' : 'none',
                opacity: !hasAtLeastOneIndicator ? 0.6 : 1,
              }}
              title={!hasAtLeastOneIndicator ? 'Please enable at least one indicator below to run backtest' : ''}
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

        {/* Section 2: Strategy Indicators (Each Indicator on its own Line) */}
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
              STRATEGY INDICATORS (TOGGLE ON/OFF)
            </span>
            {!hasAtLeastOneIndicator && (
              <span style={{ fontSize: '12px', color: '#f85149', fontWeight: 600 }}>
                ⚠️ At least one indicator must be enabled
              </span>
            )}
          </div>

          {/* Line 1: Moving Average Crossover (EMA / SMA) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              backgroundColor: maEnabled ? 'rgba(56, 189, 248, 0.05)' : '#0d1117',
              border: `1px solid ${maEnabled ? 'rgba(56, 189, 248, 0.35)' : '#21262d'}`,
              borderRadius: '6px',
              padding: '10px 14px',
              transition: 'all 0.15s ease',
            }}
          >
            {/* Checkbox & Name */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                userSelect: 'none',
                minWidth: '220px',
              }}
            >
              <input
                type="checkbox"
                checked={maEnabled}
                onChange={(e) => setMaEnabled(e.target.checked)}
                style={{ accentColor: '#38bdf8', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '13px', fontWeight: 700, color: maEnabled ? '#f0f6fc' : '#8b949e' }}>
                Moving Average Crossover
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: maEnabled ? 'rgba(56, 189, 248, 0.2)' : '#21262d',
                  color: maEnabled ? '#38bdf8' : '#6e7681',
                }}
              >
                {maEnabled ? 'ON' : 'OFF'}
              </span>
            </label>

            {/* MA Type */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: maEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Type:</label>
              <select
                value={maType}
                disabled={!maEnabled}
                onChange={(e) => setMaType(e.target.value as 'ema' | 'sma')}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  cursor: maEnabled ? 'pointer' : 'not-allowed',
                }}
              >
                <option value="ema">EMA (Exponential)</option>
                <option value="sma">SMA (Simple)</option>
              </select>
            </div>

            {/* Fast Period */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: maEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Fast Period:</label>
              <input
                type="number"
                min={2}
                max={100}
                disabled={!maEnabled}
                value={btFastPeriod}
                onChange={(e) => setBtFastPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '75px',
                  cursor: maEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>

            {/* Slow Period */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: maEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Slow Period:</label>
              <input
                type="number"
                min={3}
                max={300}
                disabled={!maEnabled}
                value={btSlowPeriod}
                onChange={(e) => setBtSlowPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '75px',
                  cursor: maEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>
          </div>

          {/* Line 2: Relative Strength Index (RSI) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              backgroundColor: rsiEnabled ? 'rgba(168, 85, 247, 0.05)' : '#0d1117',
              border: `1px solid ${rsiEnabled ? 'rgba(168, 85, 247, 0.35)' : '#21262d'}`,
              borderRadius: '6px',
              padding: '10px 14px',
              transition: 'all 0.15s ease',
            }}
          >
            {/* Checkbox & Name */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                userSelect: 'none',
                minWidth: '220px',
              }}
            >
              <input
                type="checkbox"
                checked={rsiEnabled}
                onChange={(e) => setRsiEnabled(e.target.checked)}
                style={{ accentColor: '#a855f7', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '13px', fontWeight: 700, color: rsiEnabled ? '#f0f6fc' : '#8b949e' }}>
                Relative Strength Index (RSI)
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: rsiEnabled ? 'rgba(168, 85, 247, 0.2)' : '#21262d',
                  color: rsiEnabled ? '#c084fc' : '#6e7681',
                }}
              >
                {rsiEnabled ? 'ON' : 'OFF'}
              </span>
            </label>

            {/* RSI Period */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: rsiEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Period:</label>
              <input
                type="number"
                min={2}
                max={50}
                disabled={!rsiEnabled}
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
                  cursor: rsiEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>

            {/* Buy Zone */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: rsiEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Buy Zone:</label>
              <input
                type="number"
                min={1}
                max={99}
                disabled={!rsiEnabled}
                value={rsiBuyMin}
                onChange={(e) => setRsiBuyMin(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                  cursor: rsiEnabled ? 'text' : 'not-allowed',
                }}
              />
              <span style={{ color: '#8b949e', fontSize: '12px' }}>-</span>
              <input
                type="number"
                min={1}
                max={99}
                disabled={!rsiEnabled}
                value={rsiBuyMax}
                onChange={(e) => setRsiBuyMax(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                  cursor: rsiEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>

            {/* Sell Zone */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: rsiEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Sell Zone:</label>
              <input
                type="number"
                min={1}
                max={99}
                disabled={!rsiEnabled}
                value={rsiSellMin}
                onChange={(e) => setRsiSellMin(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                  cursor: rsiEnabled ? 'text' : 'not-allowed',
                }}
              />
              <span style={{ color: '#8b949e', fontSize: '12px' }}>-</span>
              <input
                type="number"
                min={1}
                max={99}
                disabled={!rsiEnabled}
                value={rsiSellMax}
                onChange={(e) => setRsiSellMax(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                  cursor: rsiEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>

            {/* Lookback (L) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: rsiEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Lookback (L):</label>
              <input
                type="number"
                min={1}
                max={50}
                disabled={!rsiEnabled}
                value={rsiLookback}
                onChange={(e) => setRsiLookback(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                  cursor: rsiEnabled ? 'text' : 'not-allowed',
                }}
              />
              <span style={{ fontSize: '11px', color: '#8b949e' }}>candles</span>
            </div>
          </div>

          {/* Line 3: MACD */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              backgroundColor: macdEnabled ? 'rgba(234, 179, 8, 0.05)' : '#0d1117',
              border: `1px solid ${macdEnabled ? 'rgba(234, 179, 8, 0.35)' : '#21262d'}`,
              borderRadius: '6px',
              padding: '10px 14px',
              transition: 'all 0.15s ease',
            }}
          >
            {/* Checkbox & Name */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                userSelect: 'none',
                minWidth: '220px',
              }}
            >
              <input
                type="checkbox"
                checked={macdEnabled}
                onChange={(e) => setMacdEnabled(e.target.checked)}
                style={{ accentColor: '#eab308', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '13px', fontWeight: 700, color: macdEnabled ? '#f0f6fc' : '#8b949e' }}>
                MACD (Convergence / Divergence)
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: macdEnabled ? 'rgba(234, 179, 8, 0.2)' : '#21262d',
                  color: macdEnabled ? '#facc15' : '#6e7681',
                }}
              >
                {macdEnabled ? 'ON' : 'OFF'}
              </span>
            </label>

            {/* Fast */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: macdEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Fast:</label>
              <input
                type="number"
                min={2}
                max={50}
                disabled={!macdEnabled}
                value={macdFastPeriod}
                onChange={(e) => setMacdFastPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                  cursor: macdEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>

            {/* Slow */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: macdEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Slow:</label>
              <input
                type="number"
                min={3}
                max={100}
                disabled={!macdEnabled}
                value={macdSlowPeriod}
                onChange={(e) => setMacdSlowPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                  cursor: macdEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>

            {/* Signal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: macdEnabled ? 1 : 0.4 }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Signal:</label>
              <input
                type="number"
                min={2}
                max={50}
                disabled={!macdEnabled}
                value={macdSignalPeriod}
                onChange={(e) => setMacdSignalPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  width: '65px',
                  cursor: macdEnabled ? 'text' : 'not-allowed',
                }}
              />
            </div>
          </div>

          {/* Line 4: Strategy Rules & Take Profit */}
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
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc', minWidth: '220px' }}>
              🎯 Strategy Rules & Exit
            </span>

            {/* Exit Mode */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Exit Mode:</label>
              <select
                value={exitMode}
                onChange={(e) => setExitMode(e.target.value as 'mirror' | 'emaCross' | 'macdCross')}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                <option value="mirror">Triple Mirror (AND)</option>
                <option value="emaCross">EMA Cross Down</option>
                <option value="macdCross">MACD Cross Down</option>
              </select>
            </div>

            {/* Crossover Window */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Crossover Window:</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={confirmationWindow}
                  onChange={(e) => setConfirmationWindow(Number(e.target.value))}
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
                <span style={{ fontSize: '12px', color: '#8b949e' }}>candles</span>
              </div>
            </div>

            {/* Take Profit % */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={takeProfitEnabled}
                  onChange={(e) => setTakeProfitEnabled(e.target.checked)}
                  style={{ accentColor: '#2ea043', width: '14px', height: '14px', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '12px', color: takeProfitEnabled ? '#e6edf3' : '#8b949e', fontWeight: 600 }}>
                  Take Profit:
                </span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: takeProfitEnabled ? 1 : 0.4 }}>
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
                <span style={{ fontSize: '12px', color: stopLossEnabled ? '#e6edf3' : '#8b949e', fontWeight: 600 }}>
                  Stop Loss:
                </span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: stopLossEnabled ? 1 : 0.4 }}>
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
          smaFast={isBacktestMatchingChart && backtestResult?.maEnabled ? backtestResult?.indicators.smaFast : []}
          smaSlow={isBacktestMatchingChart && backtestResult?.maEnabled ? backtestResult?.indicators.smaSlow : []}
          maType={backtestResult?.maType ?? maType}
          fastPeriod={backtestResult?.fastPeriod ?? btFastPeriod}
          slowPeriod={backtestResult?.slowPeriod ?? btSlowPeriod}
          rsiValues={isBacktestMatchingChart ? backtestResult?.indicators.rsi : undefined}
          rsiPeriod={rsiPeriod}
          macdValues={isBacktestMatchingChart ? backtestResult?.indicators.macd : undefined}
          macdFast={macdFastPeriod}
          macdSlow={macdSlowPeriod}
          macdSignal={macdSignalPeriod}
          trades={isBacktestMatchingChart ? backtestResult?.trades : []}
          currentInterval={chartInterval}
          onIntervalChange={handleChartIntervalChange}
          loading={chartLoading}
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
                <strong style={{ color: '#38bdf8' }}>{backtestResult.totalCandles.toLocaleString()}</strong> candles
                {backtestResult.startTime && backtestResult.endTime && (
                  <span style={{ color: '#8b949e', marginLeft: '6px' }}>
                    ({formatDate(backtestResult.startTime)} – {formatDate(backtestResult.endTime)})
                  </span>
                )}
                <span style={{ color: '#8b949e', marginLeft: '10px' }}>
                  Indicators: {[
                    backtestResult.maEnabled ? `${backtestResult.maType.toUpperCase()} (${backtestResult.fastPeriod}/${backtestResult.slowPeriod})` : null,
                    backtestResult.rsiEnabled ? 'RSI' : null,
                    backtestResult.macdEnabled ? 'MACD' : null,
                  ].filter(Boolean).join(', ')}
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

          {/* Metrics Cards */}
          <MetricsCards metrics={backtestResult.metrics} initialBalance={backtestResult.initialBalance} />

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
          <p style={{ fontSize: '13px', color: '#8b949e', maxWidth: '520px', margin: 0, lineHeight: 1.5 }}>
            The chart above is active for technical inspection. Adjust your strategy parameters in the configuration panel and click <strong style={{ color: '#2ea043' }}>Run Backtest ⚡</strong> to simulate historical performance.
          </p>
        </section>
      )}
    </div>
  );
}
