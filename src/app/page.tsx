'use client';

import React, { useState, useEffect, useCallback } from 'react';
import CandleChart from './components/CandleChart';
import EquityChart from './components/EquityChart';
import MetricsCards from './components/MetricsCards';
import TradesTable from './components/TradesTable';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { BacktestMetrics, Trade } from '@/backtest/types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'AVAXUSDT'];
const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export default function DashboardPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState<CandleInterval>('1h');
  const [limit, setLimit] = useState(300);
  const [fastPeriod, setFastPeriod] = useState(10);
  const [slowPeriod, setSlowPeriod] = useState(30);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [tradeFeePercent, setTradeFeePercent] = useState(0.1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [smaFast, setSmaFast] = useState<number[]>([]);
  const [smaSlow, setSmaSlow] = useState<number[]>([]);
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equity, setEquity] = useState<number[]>([]);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          interval,
          limit,
          fastPeriod,
          slowPeriod,
          initialBalance,
          tradeFeePercent,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to execute backtest');
      }

      setCandles(data.candles);
      setSmaFast(data.indicators.smaFast);
      setSmaSlow(data.indicators.smaSlow);
      setMetrics(data.backtest.metrics);
      setTrades(data.backtest.trades);
      setEquity(data.backtest.equity);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, limit, fastPeriod, slowPeriod, initialBalance, tradeFeePercent]);

  // Run automatically on first mount
  useEffect(() => {
    runBacktest();
  }, [runBacktest]);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
          <span style={{ fontSize: '28px' }}>🤖</span>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#f0f6fc' }}>TradeBot Terminal</h1>
            <p style={{ fontSize: '13px', color: '#8b949e' }}>
              Algorithmic Trading, Indicators & Backtesting Engine
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#2ea043',
            }}
          />
          <span style={{ fontSize: '12px', color: '#8b949e' }}>Engine Ready</span>
        </div>
      </header>

      {/* Control Bar */}
      <section
        style={{
          backgroundColor: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '16px',
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
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{
              backgroundColor: '#0d1117',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '13px',
            }}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Interval */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Timeframe</label>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as CandleInterval)}
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

        {/* Candle Count */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Candles</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{
              backgroundColor: '#0d1117',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '13px',
            }}
          >
            <option value={100}>100</option>
            <option value={300}>300</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>

        {/* Fast SMA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '90px' }}>
          <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Fast SMA</label>
          <input
            type="number"
            min={2}
            max={100}
            value={fastPeriod}
            onChange={(e) => setFastPeriod(Number(e.target.value))}
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
            value={slowPeriod}
            onChange={(e) => setSlowPeriod(Number(e.target.value))}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '120px' }}>
          <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Balance ($)</label>
          <input
            type="number"
            step={500}
            min={100}
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
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
            value={tradeFeePercent}
            onChange={(e) => setTradeFeePercent(Number(e.target.value))}
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
          onClick={runBacktest}
          disabled={loading}
          style={{
            backgroundColor: loading ? '#21262d' : '#238636',
            color: '#ffffff',
            fontWeight: 600,
            padding: '8px 20px',
            borderRadius: '6px',
            fontSize: '13px',
            height: '37px',
            transition: 'background-color 0.2s',
          }}
        >
          {loading ? 'Running...' : 'Run Backtest ⚡'}
        </button>
      </section>

      {/* Error Banner */}
      {error && (
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
          Error: {error}
        </div>
      )}

      {/* Metrics Cards */}
      {metrics && <MetricsCards metrics={metrics} initialBalance={initialBalance} />}

      {/* Candlestick & Indicators Chart */}
      <CandleChart
        candles={candles}
        smaFast={smaFast}
        smaSlow={smaSlow}
        fastPeriod={fastPeriod}
        slowPeriod={slowPeriod}
        trades={trades}
      />

      {/* Equity Curve Chart */}
      {equity.length > 0 && (
        <EquityChart
          candles={candles}
          equity={equity}
          initialBalance={initialBalance}
        />
      )}

      {/* Executed Trades Table */}
      <TradesTable trades={trades} />
    </div>
  );
}

