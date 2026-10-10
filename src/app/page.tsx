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
  fastPeriod: number;
  slowPeriod: number;
  initialBalance: number;
  metrics: BacktestMetrics;
  trades: Trade[];
  equity: number[];
  indicators: {
    smaFast: number[];
    smaSlow: number[];
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
  const [btFastPeriod, setBtFastPeriod] = useState(10);
  const [btSlowPeriod, setBtSlowPeriod] = useState(30);
  const [btInitialBalance, setBtInitialBalance] = useState(10000);
  const [btTradeFeePercent, setBtTradeFeePercent] = useState(0.1);
  const [btLimit, setBtLimit] = useState<string>('all');

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
          fastPeriod: btFastPeriod,
          slowPeriod: btSlowPeriod,
          initialBalance: btInitialBalance,
          tradeFeePercent: btTradeFeePercent,
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
        fastPeriod: btFastPeriod,
        slowPeriod: btSlowPeriod,
        initialBalance: btInitialBalance,
        metrics: data.backtest?.metrics,
        trades: data.backtest?.trades ?? [],
        equity: data.backtest?.equity ?? [],
        indicators: {
          smaFast: data.indicators?.smaFast ?? [],
          smaSlow: data.indicators?.smaSlow ?? [],
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
  }, [btSymbol, btInterval, btFastPeriod, btSlowPeriod, btInitialBalance, btTradeFeePercent, btLimit]);

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

          {/* Fast SMA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '90px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Fast SMA</label>
            <input
              type="number"
              min={2}
              max={100}
              value={btFastPeriod}
              onChange={(e) => setBtFastPeriod(Number(e.target.value))}
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

          {/* Slow SMA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '90px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Slow SMA</label>
            <input
              type="number"
              min={3}
              max={300}
              value={btSlowPeriod}
              onChange={(e) => setBtSlowPeriod(Number(e.target.value))}
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

          {/* Initial Balance */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '110px' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '80px' }}>
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
          candles={chartCandles}
          symbol={chartSymbol}
          smaFast={isBacktestMatchingChart ? backtestResult?.indicators.smaFast : []}
          smaSlow={isBacktestMatchingChart ? backtestResult?.indicators.smaSlow : []}
          fastPeriod={backtestResult?.fastPeriod}
          slowPeriod={backtestResult?.slowPeriod}
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
              </span>
            </div>

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
