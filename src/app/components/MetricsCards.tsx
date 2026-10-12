'use client';

import React from 'react';
import type { BacktestMetrics } from '@/backtest/types';

interface MetricsCardsProps {
  metrics: BacktestMetrics;
  initialBalance: number;
}

export default function MetricsCards({ metrics, initialBalance }: MetricsCardsProps) {
  const isNetProfit = metrics.totalPnl >= 0;

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: '8px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#8b949e',
    textTransform: 'uppercase',
    fontWeight: 600,
    letterSpacing: '0.5px',
  };

  const breakdownStyle: React.CSSProperties = {
    fontSize: '11px',
    color: '#8b949e',
    marginTop: '4px',
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
      }}
    >
      {/* Total Net Profit */}
      <div style={cardStyle}>
        <span style={labelStyle}>Total Net PnL</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: isNetProfit ? '#3fb950' : '#f85149' }}>
          {isNetProfit ? '+' : ''}${metrics.totalPnl.toLocaleString()}
          <span style={{ fontSize: '13px', marginLeft: '6px', opacity: 0.85 }}>
            ({isNetProfit ? '+' : ''}{metrics.totalPnlPercent}%)
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>
            Long: <strong style={{ color: metrics.long.totalPnl >= 0 ? '#3fb950' : '#f85149' }}>
              {metrics.long.totalPnl >= 0 ? '+' : ''}${metrics.long.totalPnl.toLocaleString()}
            </strong>
          </span>
          <span>•</span>
          <span>
            Short: <strong style={{ color: metrics.short.totalPnl >= 0 ? '#3fb950' : '#f85149' }}>
              {metrics.short.totalPnl >= 0 ? '+' : ''}${metrics.short.totalPnl.toLocaleString()}
            </strong>
          </span>
        </div>
      </div>

      {/* Win Rate */}
      <div style={cardStyle}>
        <span style={labelStyle}>Win Rate</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: metrics.winRate >= 0.5 ? '#3fb950' : '#d29922' }}>
          {(metrics.winRate * 100).toFixed(1)}%
          <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '6px' }}>
            ({metrics.winningTrades}W / {metrics.losingTrades}L)
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>
            Long: <strong style={{ color: '#e6edf3' }}>{(metrics.long.winRate * 100).toFixed(1)}%</strong> ({metrics.long.winningTrades}W/{metrics.long.losingTrades}L)
          </span>
          <span>•</span>
          <span>
            Short: <strong style={{ color: '#e6edf3' }}>{(metrics.short.winRate * 100).toFixed(1)}%</strong> ({metrics.short.winningTrades}W/{metrics.short.losingTrades}L)
          </span>
        </div>
      </div>

      {/* Max Drawdown */}
      <div style={cardStyle}>
        <span style={labelStyle}>Max Drawdown</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#f85149' }}>
          -{metrics.maxDrawdownPercent.toFixed(1)}%
        </div>
        <div style={breakdownStyle}>
          <span>Drawdown ratio: {(metrics.maxDrawdown * 100).toFixed(2)}%</span>
        </div>
      </div>

      {/* Sharpe Ratio */}
      <div style={cardStyle}>
        <span style={labelStyle}>Sharpe Ratio</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: metrics.sharpeRatio >= 1 ? '#3fb950' : '#e6edf3' }}>
          {metrics.sharpeRatio.toFixed(2)}
        </div>
        <div style={breakdownStyle}>
          <span>Risk-adjusted performance</span>
        </div>
      </div>

      {/* Total Trades */}
      <div style={cardStyle}>
        <span style={labelStyle}>Total Trades</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#e6edf3' }}>
          {metrics.totalTrades}
          <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '6px' }}>
            Avg: {metrics.averageTradeReturn > 0 ? '+' : ''}{metrics.averageTradeReturn}%
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>
            Long: <strong style={{ color: '#38bdf8' }}>{metrics.long.totalTrades}</strong>
          </span>
          <span>•</span>
          <span>
            Short: <strong style={{ color: '#facc15' }}>{metrics.short.totalTrades}</strong>
          </span>
        </div>
      </div>

      {/* Final Balance */}
      <div style={cardStyle}>
        <span style={labelStyle}>Final Balance</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#e6edf3' }}>
          ${metrics.finalBalance.toLocaleString()}
          <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '6px' }}>
            Start: ${initialBalance.toLocaleString()}
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>Net Return: {isNetProfit ? '+' : ''}{metrics.totalPnlPercent}%</span>
        </div>
      </div>
    </div>
  );
}
