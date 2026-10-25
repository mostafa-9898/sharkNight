'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import CandleChart from './components/CandleChart';
import EquityChart from './components/EquityChart';
import MetricsCards from './components/MetricsCards';
import TradesTable from './components/TradesTable';
import type { Candle, CandleInterval } from '@/data/models/candle';
import type { BacktestMetrics, Trade, TradeMode, StopCheckMode, ExitMode, MultiPositionDiagnostics, SignalFunnel } from '@/backtest/types';
import {
  DEFAULT_TRADE_MODE,
  DEFAULT_POSITION_SIZE_PERCENT,
  DEFAULT_MAX_OPEN_POSITIONS,
  DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT,
  DEFAULT_MIN_BARS_BETWEEN_ENTRIES,
  DEFAULT_TRAILING_MODE,
  DEFAULT_INITIAL_STOP_PERCENT,
  DEFAULT_TRAIL_STEP_PERCENT,
  DEFAULT_TRAIL_RAISE_PERCENT,
  DEFAULT_FISHER_MODE,
  DEFAULT_FISHER_KIND,
  DEFAULT_FISHER_GATE,
  DEFAULT_OSCILLATOR_DISPLAY,
} from '@/config/defaults';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

interface BacktestDiagnostics {
  buySetups?: number;
  sellSetups?: number;
  executedTradesLong: number;
  executedTradesShort: number;
  executedTradesTotal: number;
  signalFunnel?: SignalFunnel;
}

interface BacktestResultData {
  strategyName?: string;
  symbol: string;
  interval: CandleInterval;
  ichimokuTenkan: number;
  ichimokuKijun: number;
  ichimokuSenkouB: number;
  ichimokuDisplacement: number;
  rsiPeriod: number;
  rsiBuyMin?: number;
  rsiBuyMax?: number;
  rsiSellMin?: number;
  rsiSellMax?: number;
  rsiLookback?: number;
  tradeMode: TradeMode;
  exitMode?: ExitMode;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxBarsInTrade?: number;
  rsiRecoveryCap?: number;
  period?: string;
  positionSizePercent?: number;
  riskPerTradePercent?: number;
  cloudFilter?: string;
  strategyType?: string;
  stochKPeriod?: number;
  stochDPeriod?: number;
  stochSmooth?: number;
  stochOversold?: number;
  stochOverbought?: number;
  useTdrStop?: boolean;
  tdrMultiplier?: number;
  initialBalance: number;
  metrics: BacktestMetrics;
  trades: Trade[];
  equity: number[];
  dataSource?: 'binance' | 'kucoin' | 'cache' | 'synthetic';
  diagnostics?: BacktestDiagnostics;
  signalFunnel?: SignalFunnel;
  multiPositionDiagnostics?: MultiPositionDiagnostics;
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
    stochastic?: {
      k: number[];
      d: number[];
      params: {
        kPeriod: number;
        dPeriod: number;
        smooth: number;
        oversold: number;
        overbought: number;
      };
    };
    mtf?: {
      enabled: boolean;
      strategyType?: string;
      useTdrStop?: boolean;
      tdrMultiplier?: number;
      trendRequirement?: string;
      htf4hCandlesCount?: number;
      htf1hCandlesCount?: number;
    };
    rsiLookback?: number;
    rsiRecoveryCap?: number;
    tradeMode?: TradeMode;
    exitMode?: ExitMode;
    maxBarsInTrade?: number;
    period?: string;
    takeProfitPercent?: number;
    stopLossPercent?: number;
    trailingStop?: {
      enabled: boolean;
      initialStopPercent?: number;
      stepPercent?: number;
      raisePercent?: number;
    };
    slippagePercent?: number;
    stopCheckMode?: StopCheckMode;
    cloudFilter?: string;
    positionSizePercent?: number;
    riskPerTradePercent?: number;
  };
  candles: Candle[];
  totalCandles: number;
  startTime: number | null;
  endTime: number | null;
}

export default function DashboardPage() {
  // Strategy Mode & Engine (Locked to Multi-Timeframe)
  const strategyType = 'mtf';
  const [exitMode, setExitMode] = useState<ExitMode>('trailingOnly');
  const [stopLossPercent, setStopLossPercent] = useState<number>(3);
  const [btSymbol, setBtSymbol] = useState('BTCUSDT');
  const [btInterval, setBtInterval] = useState<CandleInterval>('15m');
  const [btPeriod, setBtPeriod] = useState<string>('all');
  const [btLimit, setBtLimit] = useState<string>('all');
  const [btInitialBalance, setBtInitialBalance] = useState(10000);
  const [btTradeFeePercent, setBtTradeFeePercent] = useState(0.1);

  // Ichimoku Parameters
  const [ichimokuTenkan, setIchimokuTenkan] = useState(9);
  const [ichimokuKijun, setIchimokuKijun] = useState(26);
  const [ichimokuSenkouB, setIchimokuSenkouB] = useState(52);
  const [ichimokuDisplacement, setIchimokuDisplacement] = useState(26);

  // RSI Period (for Fisher RSI & IFT-RSI)
  const [rsiPeriod, setRsiPeriod] = useState(14);

  // Stochastic Parameters (LTF Confirmation)
  const [stochKPeriod, setStochKPeriod] = useState(14);
  const [stochDPeriod, setStochDPeriod] = useState(3);
  const [stochSmooth, setStochSmooth] = useState(3);
  const [stochOversold, setStochOversold] = useState(30);
  const [stochOverbought, setStochOverbought] = useState(70);

  // TDR Stop Loss
  const [useTdrStop, setUseTdrStop] = useState(false);
  const [tdrMultiplier, setTdrMultiplier] = useState(1.5);

  // Trade Mode & Risk Management
  const [tradeMode, setTradeMode] = useState<TradeMode>(DEFAULT_TRADE_MODE);

  // Position Sizing & Cloud Filter
  const [positionSizePercent, setPositionSizePercent] = useState<number>(DEFAULT_POSITION_SIZE_PERCENT);
  const [maxOpenPositions, setMaxOpenPositions] = useState<number>(DEFAULT_MAX_OPEN_POSITIONS);
  const [maxTotalExposurePercent, setMaxTotalExposurePercent] = useState<number>(DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT);
  const [minBarsBetweenEntries] = useState<number>(DEFAULT_MIN_BARS_BETWEEN_ENTRIES);
  const [riskPerTradePercent, setRiskPerTradePercent] = useState<number>(1);
  const [cloudFilter, setCloudFilter] = useState<'off' | 'trend' | 'strongCross'>('trend');
  const [kijunSlopeFilter, setKijunSlopeFilter] = useState(true);
  const [structureFilter, setStructureFilter] = useState(true);

  // Trailing Stop & Execution Mode (Calibrated for trend riding: 5% initial stop, 3% trigger, 1.5% trail)
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(true);
  const [trailingMode, setTrailingMode] = useState<'trend' | 'stepped'>(DEFAULT_TRAILING_MODE);
  const [initialStopPercent, setInitialStopPercent] = useState(DEFAULT_INITIAL_STOP_PERCENT);
  const [trailStepPercent, setTrailStepPercent] = useState(DEFAULT_TRAIL_STEP_PERCENT);
  const [trailRaisePercent, setTrailRaisePercent] = useState(DEFAULT_TRAIL_RAISE_PERCENT);
  const [lookbackBars, setLookbackBars] = useState(3);
  const [minConfirmations, setMinConfirmations] = useState(2);
  const [trendRequirement, setTrendRequirement] = useState<'either' | '4h_and_1h' | '4h_only'>('either');
  const [fisherMode, setFisherMode] = useState<'off' | 'extra-trigger' | 'replace-stoch' | 'confirm'>(DEFAULT_FISHER_MODE);
  const [fisherKind, setFisherKind] = useState<'fisher' | 'ift'>(DEFAULT_FISHER_KIND);
  const [fisherGate, setFisherGate] = useState<'none' | 'zone'>(DEFAULT_FISHER_GATE);
  const [oscillatorDisplay, setOscillatorDisplay] = useState<'rsi' | 'fisher' | 'ift'>(DEFAULT_OSCILLATOR_DISPLAY);
  const [slippagePercent, setSlippagePercent] = useState(0);
  const [stopCheckMode, setStopCheckMode] = useState<StopCheckMode>('intrabar');

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
          period: btPeriod,
          limit: btLimit === 'all' ? undefined : Number(btLimit),
          initialBalance: btInitialBalance,
          tradeFeePercent: btTradeFeePercent,
          positionSizePercent,
          maxOpenPositions,
          maxTotalExposurePercent,
          minBarsBetweenEntries,
          riskPerTradePercent,
          cloudFilter,
          kijunSlopeFilter,
          structureFilter,
          fisherMode,
          fisherKind,
          fisherGate,
          ichimokuTenkan,
          ichimokuKijun,
          ichimokuSenkouB,
          ichimokuDisplacement,
          rsiPeriod,
          tradeMode,
          exitMode,
          stopLossPercent,
          strategyType,
          stochKPeriod,
          stochDPeriod,
          stochSmooth,
          stochOversold,
          stochOverbought,
          useTdrStop,
          tdrMultiplier,
          lookbackBars,
          minConfirmations,
          trendRequirement,
          trailingStopEnabled,
          trailingMode: trailingStopEnabled ? trailingMode : undefined,
          initialStopPercent: trailingStopEnabled ? initialStopPercent : undefined,
          trailStepPercent: trailingStopEnabled ? trailStepPercent : undefined,
          trailRaisePercent: trailingStopEnabled ? trailRaisePercent : undefined,
          slippagePercent,
          stopCheckMode,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to execute backtest');
      }

      const candles: Candle[] = data.candles ?? [];
      const result: BacktestResultData = {
        strategyName: data.strategyName ?? 'MultiTimeframe',
        symbol: btSymbol,
        interval: btInterval,
        period: btPeriod,
        dataSource: data.dataSource,
        positionSizePercent,
        riskPerTradePercent,
        cloudFilter,
        strategyType,
        stochKPeriod,
        stochDPeriod,
        stochSmooth,
        stochOversold,
        stochOverbought,
        useTdrStop,
        tdrMultiplier,
        exitMode,
        stopLossPercent,
        ichimokuTenkan,
        ichimokuKijun,
        ichimokuSenkouB,
        ichimokuDisplacement,
        rsiPeriod,
        tradeMode,
        initialBalance: btInitialBalance,
        metrics: data.backtest?.metrics,
        trades: data.backtest?.trades ?? [],
        equity: data.backtest?.equity ?? [],
        diagnostics: data.diagnostics,
        multiPositionDiagnostics: data.backtest?.multiPositionDiagnostics,
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
    btPeriod,
    btLimit,
    btInitialBalance,
    btTradeFeePercent,
    positionSizePercent,
    maxOpenPositions,
    maxTotalExposurePercent,
    riskPerTradePercent,
    cloudFilter,
    kijunSlopeFilter,
    structureFilter,
    strategyType,
    stochKPeriod,
    stochDPeriod,
    stochSmooth,
    stochOversold,
    stochOverbought,
    useTdrStop,
    tdrMultiplier,
    ichimokuTenkan,
    ichimokuKijun,
    ichimokuSenkouB,
    ichimokuDisplacement,
    rsiPeriod,
    tradeMode,
    exitMode,
    stopLossPercent,
    trailingStopEnabled,
    trailingMode,
    initialStopPercent,
    trailStepPercent,
    trailRaisePercent,
    lookbackBars,
    minConfirmations,
    slippagePercent,
    stopCheckMode,
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
              Multi-Timeframe Strategy & Trend Ratchet Engine (Ichimoku + Stoch + Fisher/IFT)
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
          {/* Strategy Engine */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Strategy Engine</label>
            <div
              style={{
                backgroundColor: '#0d1117',
                color: '#38bdf8',
                border: '1px solid #1f6feb',
                borderRadius: '6px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '37px',
              }}
            >
              <span>🌐 Multi-Timeframe (4h/1h Trend + 15m/5m Entry)</span>
            </div>
          </div>

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

          {/* Period */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Period</label>
            <select
              value={btPeriod}
              onChange={(e) => setBtPeriod(e.target.value)}
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
              <option value="all">All Cached</option>
              <option value="6y">Last 6 Years</option>
              <option value="3y">Last 3 Years</option>
              <option value="2y">Last 2 Years</option>
              <option value="1y">Last 1 Year</option>
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
              <option value="long-short">معاملات دوطرفه (Long & Short)</option>
              <option value="long-only">فقط پوزیشن خرید (Long Only)</option>
              <option value="short-only">فقط پوزیشن فروش (Short Only)</option>
            </select>
          </div>

          {/* Exit Mode */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Exit Mode</label>
            <select
              value={exitMode}
              onChange={(e) => setExitMode(e.target.value as ExitMode)}
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
              <option value="reverse">Reverse on Signal</option>
              <option value="trailingOnly">Trailing Stop Only</option>
              <option value="tkCross">TK Cross Exit</option>
              <option value="kijun">Kijun Cross Exit</option>
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
              MULTI-TIMEFRAME STRATEGY & INDICATOR SETTINGS
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

            {/* Cloud Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Cloud Filter:</label>
              <select
                value={cloudFilter}
                onChange={(e) => setCloudFilter(e.target.value as 'off' | 'trend' | 'strongCross')}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#38bdf8',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                <option value="off">Off (Default)</option>
                <option value="trend">Trend (Close vs Cloud)</option>
                <option value="strongCross">Strong Cross (TK vs Cloud)</option>
              </select>
            </div>

            {/* Kijun Slope Filter Checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={kijunSlopeFilter}
                onChange={(e) => setKijunSlopeFilter(e.target.checked)}
                style={{ accentColor: '#38bdf8', width: '14px', height: '14px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '12px', color: kijunSlopeFilter ? '#38bdf8' : '#8b949e', fontWeight: 600 }}>
                Kijun Slope
              </span>
            </label>

            {/* Structure Filter Checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={structureFilter}
                onChange={(e) => setStructureFilter(e.target.checked)}
                style={{ accentColor: '#38bdf8', width: '14px', height: '14px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '12px', color: structureFilter ? '#38bdf8' : '#8b949e', fontWeight: 600 }}>
                Structure Filter
              </span>
            </label>
          </div>


          {/* Line 2.5: Stochastic Oscillator Box (LTF Confirmation) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              backgroundColor: 'rgba(234, 179, 8, 0.05)',
              border: '1px solid rgba(234, 179, 8, 0.35)',
              borderRadius: '6px',
              padding: '10px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc' }}>
                🌊 Stochastic Oscillator (%K / %D)
              </span>
              <span style={{ fontSize: '11px', color: '#8b949e' }}>
                (LTF Reversal Confirmation)
              </span>
            </div>

            {/* %K Period */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>%K Period:</label>
              <input
                type="number"
                min={2}
                max={50}
                value={stochKPeriod}
                onChange={(e) => setStochKPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#eab308',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
            </div>

            {/* %D Period */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>%D Period:</label>
              <input
                type="number"
                min={1}
                max={20}
                value={stochDPeriod}
                onChange={(e) => setStochDPeriod(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#eab308',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
            </div>

            {/* Smooth */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Smooth:</label>
              <input
                type="number"
                min={1}
                max={20}
                value={stochSmooth}
                onChange={(e) => setStochSmooth(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#eab308',
                  fontWeight: 600,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
            </div>

            {/* Oversold */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Oversold (Buy):</label>
              <input
                type="number"
                min={5}
                max={50}
                value={stochOversold}
                onChange={(e) => setStochOversold(Number(e.target.value))}
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

            {/* Overbought */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Overbought (Sell):</label>
              <input
                type="number"
                min={50}
                max={95}
                value={stochOverbought}
                onChange={(e) => setStochOverbought(Number(e.target.value))}
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

            {/* Confluence Lookback & Confirmations Box */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                borderLeft: '1px solid rgba(234, 179, 8, 0.3)',
                paddingLeft: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a78bfa', fontWeight: 600 }}>Lookback:</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={lookbackBars}
                  onChange={(e) => setLookbackBars(Number(e.target.value))}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#a78bfa',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                    width: '45px',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#8b949e' }}>bars</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#a78bfa', fontWeight: 600 }}>Confluence:</label>
                <select
                  value={minConfirmations}
                  onChange={(e) => setMinConfirmations(Number(e.target.value))}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#a78bfa',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                  }}
                >
                  <option value={2}>2 of 3 Confirmations</option>
                  <option value={3}>3 of 3 (Strict All)</option>
                  <option value={1}>1 of 3 (Aggressive)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }}>HTF Trend:</label>
                <select
                  value={trendRequirement}
                  onChange={(e) => setTrendRequirement(e.target.value as 'either' | '4h_and_1h' | '4h_only')}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#38bdf8',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                  }}
                >
                  <option value="either">1H or 4H (Responsive)</option>
                  <option value="4h_and_1h">1H & 4H (Strict Both)</option>
                  <option value="4h_only">4H Only (Macro)</option>
                </select>
              </div>

              {/* Fisher RSI Mode & Kind */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }} title="Controls how Fisher/IFT participates in strategy entry logic">
                  Fisher Mode (Entry):
                </label>
                <select
                  value={fisherMode}
                  onChange={(e) => setFisherMode(e.target.value as 'off' | 'extra-trigger' | 'replace-stoch' | 'confirm')}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#38bdf8',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                  }}
                  title="Controls how Fisher/IFT participates in strategy entry logic (off, extra-trigger, replace-stoch, confirm)"
                >
                  <option value="off">Off (No Filter)</option>
                  <option value="extra-trigger">Extra Trigger</option>
                  <option value="replace-stoch">Replace Stoch</option>
                  <option value="confirm">Confirm</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }} title="Selects Fisher RSI vs IFT-RSI for strategy entry rules">
                  Fisher Kind (Strategy):
                </label>
                <select
                  value={fisherKind}
                  onChange={(e) => setFisherKind(e.target.value as 'fisher' | 'ift')}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#38bdf8',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                  }}
                  title="Selects Fisher RSI vs IFT-RSI for strategy rules"
                >
                  <option value="fisher">Fisher RSI</option>
                  <option value="ift">IFT-RSI</option>
                </select>
              </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }} title="Fisher Gate: 'none' triggers on any crossover, 'zone' requires crossover inside oversold/overbought zone">
                  Fisher Gate:
                </label>
                <select
                  value={fisherGate}
                  onChange={(e) => setFisherGate(e.target.value as 'none' | 'zone')}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#38bdf8',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                  }}
                  title="Fisher Gate: none (any cross) vs zone (zone-gated cross)"
                >
                  <option value="none">None (Any Cross)</option>
                  <option value="zone">Zone (OB/OS Gated)</option>
                </select>
              </div>

              {/* Chart Oscillator Display Selection */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#e879f9', fontWeight: 600 }} title="Controls which oscillator is plotted in the chart sub-chart (does not affect backtest entry signals)">
                  Oscillator Display:
                </label>
                <select
                  value={oscillatorDisplay}
                  onChange={(e) => setOscillatorDisplay(e.target.value as 'rsi' | 'fisher' | 'ift')}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#e879f9',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                  }}
                  title="Controls which oscillator is plotted in the chart sub-chart (does not affect backtest entry signals)"
                >
                  <option value="rsi">Standard RSI (0–100)</option>
                  <option value="fisher">Fisher RSI (Oscillator + Signal)</option>
                  <option value="ift">IFT-RSI (Inverse Fisher Transform)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }}>RSI Period:</label>
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={rsiPeriod}
                  onChange={(e) => setRsiPeriod(Number(e.target.value))}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#38bdf8',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '12px',
                    width: '55px',
                  }}
                />
              </div>
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
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc', minWidth: '200px' }}>
              🛡️ Risk & Sizing
            </span>

            {/* Position Size Cap % */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Size Cap:</span>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={positionSizePercent}
                onChange={(e) => setPositionSizePercent(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#38bdf8',
                  fontWeight: 700,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
              <span style={{ fontSize: '12px', color: '#8b949e' }}>%</span>
            </div>

            {/* Max Open Positions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Max Pos:</span>
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={maxOpenPositions}
                onChange={(e) => setMaxOpenPositions(Math.max(1, Number(e.target.value)))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#38bdf8',
                  fontWeight: 700,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '50px',
                }}
              />
            </div>

            {/* Max Total Exposure % */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Max Exp:</span>
              <input
                type="number"
                min={1}
                max={100}
                step={5}
                value={maxTotalExposurePercent}
                onChange={(e) => setMaxTotalExposurePercent(Math.max(1, Math.min(100, Number(e.target.value))))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#38bdf8',
                  fontWeight: 700,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
              <span style={{ fontSize: '12px', color: '#8b949e' }}>%</span>
            </div>

            {/* Risk Per Trade % */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Risk/Trade:</span>
              <input
                type="number"
                min={0.1}
                max={100}
                step={0.5}
                value={riskPerTradePercent}
                onChange={(e) => setRiskPerTradePercent(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#eab308',
                  fontWeight: 700,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
              <span style={{ fontSize: '12px', color: '#8b949e' }}>%</span>
            </div>

            {/* Stop Loss % */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#8b949e', fontWeight: 600 }}>Stop Loss:</span>
              <input
                type="number"
                min={0.1}
                max={50}
                step={0.5}
                value={stopLossPercent}
                onChange={(e) => setStopLossPercent(Number(e.target.value))}
                style={{
                  backgroundColor: '#0d1117',
                  color: '#ef4444',
                  fontWeight: 700,
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  fontSize: '12px',
                  width: '55px',
                }}
              />
              <span style={{ fontSize: '12px', color: '#8b949e' }}>%</span>
            </div>

            {/* TDR Dynamic Stop Loss */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useTdrStop}
                  onChange={(e) => setUseTdrStop(e.target.checked)}
                  style={{ accentColor: '#38bdf8', width: '14px', height: '14px', cursor: 'pointer' }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    color: useTdrStop ? '#e6edf3' : '#8b949e',
                    fontWeight: 600,
                  }}
                >
                  📐 TDR Stop (≤ 5% Cap):
                </span>
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: useTdrStop ? 1 : 0.4,
                }}
              >
                <input
                  type="number"
                  min={0.5}
                  max={5}
                  step={0.1}
                  disabled={!useTdrStop}
                  value={tdrMultiplier}
                  onChange={(e) => setTdrMultiplier(Number(e.target.value))}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#38bdf8',
                    fontWeight: 700,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    width: '60px',
                    cursor: useTdrStop ? 'text' : 'not-allowed',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#8b949e' }}>x ATR</span>
              </div>
            </div>

            {/* Trailing Stop Box */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                borderLeft: '1px solid #30363d',
                paddingLeft: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={trailingStopEnabled}
                    onChange={(e) => setTrailingStopEnabled(e.target.checked)}
                    style={{ accentColor: '#eab308', width: '14px', height: '14px', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      fontSize: '12px',
                      color: trailingStopEnabled ? '#e6edf3' : '#8b949e',
                      fontWeight: 600,
                    }}
                  >
                    Trailing Stop:
                  </span>
                </label>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: trailingStopEnabled ? 1 : 0.4,
                  }}
                >
                  {/* Mode Selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>Mode:</span>
                    <select
                      disabled={!trailingStopEnabled}
                      value={trailingMode}
                      onChange={(e) => setTrailingMode(e.target.value as 'trend' | 'stepped')}
                      style={{
                        backgroundColor: '#0d1117',
                        color: '#38bdf8',
                        fontWeight: 700,
                        border: '1px solid #30363d',
                        borderRadius: '6px',
                        padding: '3px 6px',
                        fontSize: '11px',
                        cursor: trailingStopEnabled ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <option value="stepped">🪜 جابه‌جایی پله‌ای (Stepped Ratchet)</option>
                      <option value="trend">🌊 تعقیب قله روند (Trend Follow)</option>
                    </select>
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#e3b341',
                        whiteSpace: 'nowrap',
                        marginRight: '4px',
                      }}
                      title="نتایج اعتبارسنجی با stepped است"
                    >
                      «نتایج اعتبارسنجی با stepped است»
                    </span>
                  </div>

                  {/* Initial Stop */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>Initial:</span>
                    <input
                      type="number"
                      min={0.1}
                      max={50}
                      step={0.1}
                      disabled={!trailingStopEnabled}
                      value={initialStopPercent}
                      onChange={(e) => setInitialStopPercent(Number(e.target.value))}
                      style={{
                        backgroundColor: '#0d1117',
                        color: '#eab308',
                        fontWeight: 700,
                        border: '1px solid #30363d',
                        borderRadius: '6px',
                        padding: '4px 6px',
                        fontSize: '11px',
                        width: '50px',
                        cursor: trailingStopEnabled ? 'text' : 'not-allowed',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>%</span>
                  </div>

                  {/* Step */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>Trigger:</span>
                    <input
                      type="number"
                      min={0.1}
                      max={50}
                      step={0.1}
                      disabled={!trailingStopEnabled}
                      value={trailStepPercent}
                      onChange={(e) => setTrailStepPercent(Number(e.target.value))}
                      style={{
                        backgroundColor: '#0d1117',
                        color: '#eab308',
                        fontWeight: 700,
                        border: '1px solid #30363d',
                        borderRadius: '6px',
                        padding: '4px 6px',
                        fontSize: '11px',
                        width: '50px',
                        cursor: trailingStopEnabled ? 'text' : 'not-allowed',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>%</span>
                  </div>

                  {/* Raise */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>Lock/Raise:</span>
                    <input
                      type="number"
                      min={0.1}
                      max={50}
                      step={0.1}
                      disabled={!trailingStopEnabled}
                      value={trailRaisePercent}
                      onChange={(e) => setTrailRaisePercent(Number(e.target.value))}
                      style={{
                        backgroundColor: '#0d1117',
                        color: '#eab308',
                        fontWeight: 700,
                        border: '1px solid #30363d',
                        borderRadius: '6px',
                        padding: '4px 6px',
                        fontSize: '11px',
                        width: '50px',
                        cursor: trailingStopEnabled ? 'text' : 'not-allowed',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#8b949e' }}>%</span>
                  </div>
                </div>
              </div>
              <div
                dir="rtl"
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.04)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  marginTop: '6px',
                  fontSize: '11.5px',
                  lineHeight: '1.8',
                  color: '#c9d1d9',
                  textAlign: 'right',
                  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Tahoma, sans-serif',
                }}
              >
                <div style={{ marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px dashed #30363d' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a78bfa', fontWeight: 700, marginBottom: '2px' }}>
                    <span>🎯 سیگنال ورود مولتی تایم‌فریم (۲ تایید از ۳ در ۳ کندل اخیر):</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b949e' }}>
                    روند ماکرو در تایم‌فریم ۴h و ۱h با ایچیموکو، استوکستیک و RSI تشخیص داده می‌شود. در تایم ۱۵ دقیقه، با وقوع حداقل ۲ تایید از ۳ شرط (کراس ایچیموکو، کراس استوکستیک، شیب رو به بالا/پایین RSI) در نهایتاً ۳ کندل بسته شده اخیر، پوزیشن ورود صادر می‌گردد.
                  </div>
                </div>

                {trailingMode === 'trend' ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8', fontWeight: 700, marginBottom: '2px' }}>
                      <span>🌊 تعقیب دقیق و لحظه‌ای قله روند (Trend Follow):</span>
                    </div>
                    <div>
                      • <strong style={{ color: '#f0f6fc' }}>حفظ سرمایه (ریسک‌فری):</strong> با رسیدن سود به <span style={{ color: '#eab308', fontWeight: 700 }}>%{initialStopPercent}</span>، استاپ سریعاً به نقطه ورود می‌آید تا ریسک معامله به صفر برسد.
                      <br />
                      • <strong style={{ color: '#f0f6fc' }}>افزایش سودآوری و فضای تنفس:</strong> با تنظیم تریگر روی <span style={{ color: '#38bdf8', fontWeight: 700 }}>%{trailStepPercent}</span> و فاصله تریل روی <span style={{ color: '#3fb950', fontWeight: 700 }}>%{trailRaisePercent}</span>، معامله در نوسانات عادی خفه نمی‌شود و اجازه دارد روندهای پرقدرت را تا بالاترین سقف ممکن شکار کند.
                      <br />
                      • <strong style={{ color: '#38bdf8' }}>قانون بدون بازگشت:</strong> استاپ فقط در جهت سود پیشروی می‌کند و در هیچ اصلاح یا نوسانی عقب‌نشینی نمی‌کند.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#eab308', fontWeight: 700, marginBottom: '2px' }}>
                      <span>🪜 استاپ پلکانی به سمت سود (Stepped Ratchet):</span>
                    </div>
                    <div>
                      • با رسیدن سود به <span style={{ color: '#eab308', fontWeight: 700 }}>%{initialStopPercent}</span>، استاپ به نقطه ورود (سر‌به‌سر) می‌آید.
                      <br />
                      • به ازای هر <span style={{ color: '#38bdf8', fontWeight: 700 }}>%{trailStepPercent}</span> سود جدید، استاپ دقیقاً <span style={{ color: '#3fb950', fontWeight: 700 }}>%{trailRaisePercent}</span> در جهت سود ارتقا می‌یابد و هرگز به عقب بازنمی‌گردد.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Execution Controls: Slippage and Stop Check Mode */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                borderLeft: '1px solid #30363d',
                paddingLeft: '12px',
              }}
            >
              {/* Slippage % */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: '#8b949e' }}>Slippage:</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.05}
                  value={slippagePercent}
                  onChange={(e) => setSlippagePercent(Number(e.target.value))}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#c9d1d9',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '4px 6px',
                    fontSize: '11px',
                    width: '52px',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#8b949e' }}>%</span>
              </div>

              {/* Stop Check Mode */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: '#8b949e' }}>Mode:</span>
                <select
                  value={stopCheckMode}
                  onChange={(e) => setStopCheckMode(e.target.value as StopCheckMode)}
                  style={{
                    backgroundColor: '#0d1117',
                    color: '#c9d1d9',
                    fontWeight: 600,
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  <option value="intrabar">Intrabar (wick touch)</option>
                  <option value="close">Close (candle end)</option>
                </select>
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
          stochKPeriod={stochKPeriod}
          stochDPeriod={stochDPeriod}
          stochSmooth={stochSmooth}
          stochOversold={stochOversold}
          stochOverbought={stochOverbought}
          oscillatorDisplay={oscillatorDisplay}
          onOscillatorDisplayChange={setOscillatorDisplay}
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
                  <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                    {backtestResult.strategyName ?? 'MultiTimeframe'}
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
            multiPositionDiagnostics={backtestResult.multiPositionDiagnostics}
          />

          {/* Signal Funnel (Diagnostics) - Two-column table with drop % */}
          {(backtestResult.signalFunnel || backtestResult.diagnostics?.signalFunnel) && (() => {
            const funnel = backtestResult.signalFunnel ?? backtestResult.diagnostics!.signalFunnel!;
            const long = funnel.long;
            const short = funnel.short;

            const calcDrop = (prev: number, curr: number): string => {
              if (prev <= 0) return '0.0%';
              const drop = ((prev - curr) / prev) * 100;
              return `${Math.max(0, drop).toFixed(1)}%`;
            };

            const longRejTotal = long.rejected.max_positions + long.rejected.max_exposure + long.rejected.min_bars + long.rejected.opposite_not_allowed + long.rejected.other;
            const shortRejTotal = short.rejected.max_positions + short.rejected.max_exposure + short.rejected.min_bars + short.rejected.opposite_not_allowed + short.rejected.other;

            const rows: Array<{
              id: string;
              name: string;
              desc: string;
              longCount: React.ReactNode;
              longDrop: string;
              shortCount: React.ReactNode;
              shortDrop: string;
              highlight?: boolean;
            }> = [
              {
                id: 'raw',
                name: '1. Raw Crosses (Active Triggers)',
                desc: 'تعداد کراس خام ماشه‌های فعال (TK / Stoch / Fisher)',
                longCount: (
                  <span>
                    TK: <b style={{ color: '#2ea043' }}>{long.raw?.tk ?? 0}</b> | Stoch: <b style={{ color: '#38bdf8' }}>{long.raw?.stoch ?? 0}</b> | Fisher: <b style={{ color: '#a371f7' }}>{long.raw?.fisher ?? 0}</b>
                  </span>
                ),
                longDrop: '-',
                shortCount: (
                  <span>
                    TK: <b style={{ color: '#f85149' }}>{short.raw?.tk ?? 0}</b> | Stoch: <b style={{ color: '#38bdf8' }}>{short.raw?.stoch ?? 0}</b> | Fisher: <b style={{ color: '#a371f7' }}>{short.raw?.fisher ?? 0}</b>
                  </span>
                ),
                shortDrop: '-',
              },
              {
                id: 'candidate',
                name: '2. Candidate Candles',
                desc: 'کندل‌هایی با حداقل یک ماشه فعال در جهت مربوطه',
                longCount: long.candidate,
                longDrop: '-',
                shortCount: short.candidate,
                shortDrop: '-',
              },
              {
                id: 'passHtf',
                name: '3. Pass HTF Strict (1h & 4h)',
                desc: 'تطابق هم‌جهت با تایم‌فریم‌های بالاتر',
                longCount: long.passHtf,
                longDrop: calcDrop(long.candidate, long.passHtf),
                shortCount: short.passHtf,
                shortDrop: calcDrop(short.candidate, short.passHtf),
              },
              {
                id: 'passKijunSlope',
                name: '4. Pass Kijun Slope',
                desc: 'شیب کیجون در جهت ورود',
                longCount: long.passKijunSlope,
                longDrop: calcDrop(long.passHtf, long.passKijunSlope),
                shortCount: short.passKijunSlope,
                shortDrop: calcDrop(short.passHtf, short.passKijunSlope),
              },
              {
                id: 'passStructure',
                name: '5. Pass Structure Filter',
                desc: 'فیلتر شکست سقف/کف یا فیلتر ابر ایچیموکو',
                longCount: long.passStructure,
                longDrop: calcDrop(long.passKijunSlope, long.passStructure),
                shortCount: short.passStructure,
                shortDrop: calcDrop(short.passKijunSlope, short.passStructure),
              },
              {
                id: 'passOppositeBlock',
                name: '6. Pass Opposite Block',
                desc: 'عدم وجود کراس متضاد در همان کندل',
                longCount: long.passOppositeBlock,
                longDrop: calcDrop(long.passStructure, long.passOppositeBlock),
                shortCount: short.passOppositeBlock,
                shortDrop: calcDrop(short.passStructure, short.passOppositeBlock),
              },
              {
                id: 'passFisherConfirm',
                name: '7. Pass Fisher Confirm',
                desc: 'تاییدیه فیشر (در صورت فعال بودن حالت confirm)',
                longCount: long.passFisherConfirm,
                longDrop: calcDrop(long.passOppositeBlock, long.passFisherConfirm),
                shortCount: short.passFisherConfirm,
                shortDrop: calcDrop(short.passOppositeBlock, short.passFisherConfirm),
              },
              {
                id: 'signalEmitted',
                name: '8. Signal Emitted',
                desc: 'سیگنال معتبر تولیدشده توسط استراتژی',
                longCount: long.signalEmitted,
                longDrop: calcDrop(long.passFisherConfirm, long.signalEmitted),
                shortCount: short.signalEmitted,
                shortDrop: calcDrop(short.passFisherConfirm, short.signalEmitted),
                highlight: true,
              },
              {
                id: 'entryAttempted',
                name: '9. Entry Attempted',
                desc: 'تلاش ورود به معامله توسط موتور بک‌تست',
                longCount: long.entryAttempted,
                longDrop: calcDrop(long.signalEmitted, long.entryAttempted),
                shortCount: short.entryAttempted,
                shortDrop: calcDrop(short.signalEmitted, short.entryAttempted),
                highlight: true,
              },
              {
                id: 'rejected',
                name: '10. Rejected by Engine (Breakdown)',
                desc: 'ردشده به تفکیک دلیل',
                longCount: (
                  <div>
                    <span style={{ color: '#f85149', fontWeight: 600 }}>Total: {longRejTotal}</span>
                    <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px', lineHeight: 1.4 }}>
                      max_pos: {long.rejected.max_positions} • max_exp: {long.rejected.max_exposure} • min_bars: {long.rejected.min_bars} • opp_block: {long.rejected.opposite_not_allowed} • other: {long.rejected.other}
                    </div>
                  </div>
                ),
                longDrop: calcDrop(long.entryAttempted, long.executed),
                shortCount: (
                  <div>
                    <span style={{ color: '#f85149', fontWeight: 600 }}>Total: {shortRejTotal}</span>
                    <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px', lineHeight: 1.4 }}>
                      max_pos: {short.rejected.max_positions} • max_exp: {short.rejected.max_exposure} • min_bars: {short.rejected.min_bars} • opp_block: {short.rejected.opposite_not_allowed} • other: {short.rejected.other}
                    </div>
                  </div>
                ),
                shortDrop: calcDrop(short.entryAttempted, short.executed),
              },
              {
                id: 'executed',
                name: '11. Executed Trades',
                desc: 'معاملات اجراشده نهایی (برابر با تعداد معاملات واقعی)',
                longCount: <b style={{ color: '#2ea043', fontSize: '14px' }}>{long.executed}</b>,
                longDrop: calcDrop(long.entryAttempted, long.executed),
                shortCount: <b style={{ color: '#38bdf8', fontSize: '14px' }}>{short.executed}</b>,
                shortDrop: calcDrop(short.entryAttempted, short.executed),
                highlight: true,
              },
            ];

            return (
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>🎯</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc' }}>
                      Signal Funnel (Long vs Short)
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        backgroundColor: 'rgba(46, 160, 67, 0.15)',
                        border: '1px solid #2ea043',
                        color: '#3fb950',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                      }}
                    >
                      Reconciled Invariant: Emitted = Attempted = Rejected + Executed
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#8b949e' }}>
                    Total Trades Executed: {long.executed + short.executed} ({long.executed} Long / {short.executed} Short)
                  </span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12px',
                      color: '#c9d1d9',
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: '#0d1117', borderBottom: '1px solid #30363d', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px', color: '#8b949e', width: '36%' }}>Funnel Stage</th>
                        <th style={{ padding: '8px 12px', color: '#2ea043', width: '22%' }}>Long Count</th>
                        <th style={{ padding: '8px 12px', color: '#f85149', width: '10%', textAlign: 'center' }}>Long Drop %</th>
                        <th style={{ padding: '8px 12px', color: '#38bdf8', width: '22%' }}>Short Count</th>
                        <th style={{ padding: '8px 12px', color: '#f85149', width: '10%', textAlign: 'center' }}>Short Drop %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          style={{
                            borderBottom: '1px solid #21262d',
                            backgroundColor: row.highlight ? 'rgba(56, 189, 248, 0.04)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ fontWeight: row.highlight ? 700 : 500, color: row.highlight ? '#f0f6fc' : '#c9d1d9' }}>
                              {row.name}
                            </div>
                            <div style={{ fontSize: '10px', color: '#8b949e' }}>{row.desc}</div>
                          </td>
                          <td style={{ padding: '8px 12px' }}>{row.longCount}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: row.longDrop === '0.0%' || row.longDrop === '-' ? '#8b949e' : '#f85149', fontWeight: 600 }}>
                            {row.longDrop}
                          </td>
                          <td style={{ padding: '8px 12px' }}>{row.shortCount}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: row.shortDrop === '0.0%' || row.shortDrop === '-' ? '#8b949e' : '#f85149', fontWeight: 600 }}>
                            {row.shortDrop}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

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
