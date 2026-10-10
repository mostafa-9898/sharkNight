'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import CandleChart from './components/CandleChart';
import EquityChart from './components/EquityChart';
import MetricsCards from './components/MetricsCards';
import TradesTable from './components/TradesTable';
import ActivePositionCard from './components/ActivePositionCard';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { BacktestMetrics, Trade, ActivePosition } from '@/backtest/types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

interface CachedData {
  candles: Candle[];
  smaFast: number[];
  smaSlow: number[];
  metrics: BacktestMetrics;
  trades: Trade[];
  equity: number[];
  activePosition: ActivePosition | null;
}

export default function DashboardPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState<CandleInterval>('1h');
  const [fastPeriod, setFastPeriod] = useState(10);
  const [slowPeriod, setSlowPeriod] = useState(30);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [tradeFeePercent, setTradeFeePercent] = useState(0.1);
  const [limit, setLimit] = useState(1000);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [smaFast, setSmaFast] = useState<number[]>([]);
  const [smaSlow, setSmaSlow] = useState<number[]>([]);
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equity, setEquity] = useState<number[]>([]);
  const [activePosition, setActivePosition] = useState<ActivePosition | null>(null);

  const [activeTab, setActiveTab] = useState<'position' | 'trades'>('position');

  // In-memory instant client-side cache
  const memoryCache = useRef<Map<string, CachedData>>(new Map());

  const getCacheKey = useCallback(
    (sym: string, int: CandleInterval, f: number, s: number, lim: number) =>
      `${sym}_${int}_${f}_${s}_${lim}`,
    []
  );

  const runBacktest = useCallback(
    async (targetInterval?: CandleInterval, targetSymbol?: string, targetLimit?: number) => {
      const activeSym = targetSymbol ?? symbol;
      const activeInt = targetInterval ?? interval;
      const activeLimit = targetLimit ?? limit;
      const cacheKey = getCacheKey(activeSym, activeInt, fastPeriod, slowPeriod, activeLimit);

      // Check instant memory cache first (0ms latency!)
      if (memoryCache.current.has(cacheKey)) {
        const cached = memoryCache.current.get(cacheKey)!;
        setCandles(cached.candles);
        setSmaFast(cached.smaFast);
        setSmaSlow(cached.smaSlow);
        setMetrics(cached.metrics);
        setTrades(cached.trades);
        setEquity(cached.equity);
        setActivePosition(cached.activePosition);
        if (targetInterval) setInterval(targetInterval);
        if (targetSymbol) setSymbol(targetSymbol);
        if (targetLimit) setLimit(targetLimit);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: activeSym,
            interval: activeInt,
            limit: activeLimit,
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

        const newCandles = data.candles ?? [];
        const newFast = data.indicators?.smaFast ?? [];
        const newSlow = data.indicators?.smaSlow ?? [];
        const newMetrics = data.backtest?.metrics ?? null;
        const newTrades = data.backtest?.trades ?? [];
        const newEquity = data.backtest?.equity ?? [];
        const newActivePos = data.backtest?.activePosition ?? null;

        setCandles(newCandles);
        setSmaFast(newFast);
        setSmaSlow(newSlow);
        setMetrics(newMetrics);
        setTrades(newTrades);
        setEquity(newEquity);
        setActivePosition(newActivePos);

        if (targetInterval) setInterval(targetInterval);
        if (targetSymbol) setSymbol(targetSymbol);
        if (targetLimit) setLimit(targetLimit);

        // Save to in-memory cache
        memoryCache.current.set(cacheKey, {
          candles: newCandles,
          smaFast: newFast,
          smaSlow: newSlow,
          metrics: newMetrics,
          trades: newTrades,
          equity: newEquity,
          activePosition: newActivePos,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    },
    [symbol, interval, fastPeriod, slowPeriod, limit, initialBalance, tradeFeePercent, getCacheKey]
  );

  // Initial load
  useEffect(() => {
    runBacktest();
  }, [runBacktest]);

  // Instant timeframe switch handler
  const handleTimeframeChange = (newInterval: CandleInterval) => {
    runBacktest(newInterval, undefined);
  };

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
          <span style={{ fontSize: '32px' }}>🤖</span>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#f0f6fc' }}>
              TradeBot - High Performance Trading Terminal
            </h1>
            <p style={{ fontSize: '13px', color: '#8b949e' }}>
              1-Year Historical Backtesting & Real-Time Position Monitor
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontSize: '12px',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              color: '#38bdf8',
              padding: '6px 12px',
              borderRadius: '20px',
              fontWeight: 600,
            }}
          >
            ⚡ Zero-Lag Instant Engine
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#2ea043',
                boxShadow: '0 0 6px #2ea043',
              }}
            />
            <span style={{ fontSize: '12px', color: '#8b949e' }}>Live</span>
          </div>
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
            onChange={(e) => {
              const newSym = e.target.value;
              setSymbol(newSym);
              runBacktest(undefined, newSym);
            }}
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
            value={interval}
            onChange={(e) => handleTimeframeChange(e.target.value as CandleInterval)}
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
            value={limit}
            onChange={(e) => {
              const newLimit = Number(e.target.value);
              setLimit(newLimit);
              runBacktest(undefined, undefined, newLimit);
            }}
            style={{
              backgroundColor: '#0d1117',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '13px',
            }}
          >
            <option value={300}>300 Candles (~Recent)</option>
            <option value={500}>500 Candles</option>
            <option value={1000}>1,000 Candles</option>
            <option value={2200}>1 Year (4h full ~2.2k)</option>
            <option value={8800}>1 Year (1h full ~8.8k)</option>
            <option value={35100}>1 Year (15m full ~35k)</option>
            <option value={75000}>Full 5m / 1m Dataset</option>
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
          <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Capital ($)</label>
          <input
            type="number"
            step={1000}
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
          onClick={() => runBacktest()}
          disabled={loading}
          style={{
            backgroundColor: loading ? '#21262d' : '#238636',
            color: '#ffffff',
            fontWeight: 600,
            padding: '8px 22px',
            borderRadius: '6px',
            fontSize: '13px',
            height: '37px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {loading && (
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
          {loading ? 'Simulating...' : 'Run Backtest ⚡'}
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

      {/* Real-Time Active Position Card */}
      <ActivePositionCard position={activePosition} symbol={symbol} />

      {/* Metrics Cards */}
      {metrics && <MetricsCards metrics={metrics} initialBalance={initialBalance} />}

      {/* Interactive Candlestick Chart */}
      <CandleChart
        candles={candles}
        smaFast={smaFast}
        smaSlow={smaSlow}
        fastPeriod={fastPeriod}
        slowPeriod={slowPeriod}
        trades={trades}
        currentInterval={interval}
        onIntervalChange={handleTimeframeChange}
        loading={loading}
      />

      {/* Equity Curve Chart */}
      {equity.length > 0 && (
        <EquityChart
          candles={candles}
          equity={equity}
          initialBalance={initialBalance}
        />
      )}

      {/* Trade Section Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #30363d', paddingBottom: '8px' }}>
        <button
          onClick={() => setActiveTab('position')}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: activeTab === 'position' ? 700 : 500,
            backgroundColor: activeTab === 'position' ? '#21262d' : 'transparent',
            color: activeTab === 'position' ? '#f0f6fc' : '#8b949e',
          }}
        >
          🟢 Active Position {activePosition ? '(1 Live)' : '(0)'}
        </button>

        <button
          onClick={() => setActiveTab('trades')}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: activeTab === 'trades' ? 700 : 500,
            backgroundColor: activeTab === 'trades' ? '#21262d' : 'transparent',
            color: activeTab === 'trades' ? '#f0f6fc' : '#8b949e',
          }}
        >
          📋 Executed Trades History ({trades.length})
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'position' ? (
        <ActivePositionCard position={activePosition} symbol={symbol} />
      ) : (
        <TradesTable trades={trades} />
      )}
    </div>
  );
}
