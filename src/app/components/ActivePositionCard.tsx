'use client';

import React from 'react';
import type { ActivePosition } from '@/backtest/types';

interface ActivePositionCardProps {
  position?: ActivePosition | null;
  symbol: string;
}

export default function ActivePositionCard({ position, symbol }: ActivePositionCardProps) {
  if (!position) {
    return (
      <div
        style={{
          backgroundColor: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#8b949e',
            }}
          />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#f0f6fc' }}>
              No Active Position ({symbol})
            </div>
            <div style={{ fontSize: '12px', color: '#8b949e' }}>
              Strategy is currently 100% in Cash, waiting for the next Golden Cross entry signal.
            </div>
          </div>
        </div>

        <span
          style={{
            fontSize: '12px',
            backgroundColor: '#21262d',
            color: '#8b949e',
            padding: '4px 10px',
            borderRadius: '12px',
            fontWeight: 500,
          }}
        >
          ⚪ IN CASH
        </span>
      </div>
    );
  }

  const isProfit = position.unrealizedPnl >= 0;
  const formatTime = (ts: number) =>
    new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <div
      style={{
        backgroundColor: '#161b22',
        border: `1px solid ${isProfit ? '#2ea043' : '#f85149'}`,
        borderRadius: '8px',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#2ea043',
              boxShadow: '0 0 8px #2ea043',
            }}
          />
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#f0f6fc' }}>
            Active Real-Time Position: {symbol} (LONG)
          </span>
        </div>

        <span
          style={{
            fontSize: '12px',
            backgroundColor: isProfit ? 'rgba(46, 160, 67, 0.15)' : 'rgba(248, 81, 73, 0.15)',
            color: isProfit ? '#3fb950' : '#f85149',
            border: `1px solid ${isProfit ? '#2ea043' : '#f85149'}`,
            padding: '4px 10px',
            borderRadius: '12px',
            fontWeight: 700,
          }}
        >
          🟢 LIVE POSITION
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '12px',
          paddingTop: '8px',
          borderTop: '1px solid #30363d',
        }}
      >
        <div>
          <span style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Entry Price</span>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>
            ${position.entryPrice.toLocaleString()}
          </div>
          <span style={{ fontSize: '11px', color: '#8b949e' }}>{formatTime(position.entryTime)}</span>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Current Price</span>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>
            ${position.currentPrice.toLocaleString()}
          </div>
          <span style={{ fontSize: '11px', color: '#8b949e' }}>Live Market</span>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Unrealized PnL</span>
          <div style={{ fontSize: '16px', fontWeight: 700, color: isProfit ? '#3fb950' : '#f85149' }}>
            {isProfit ? '+' : ''}${position.unrealizedPnl.toFixed(2)}
            <span style={{ fontSize: '12px', marginLeft: '4px' }}>
              ({isProfit ? '+' : ''}{position.unrealizedPnlPercent.toFixed(2)}%)
            </span>
          </div>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Invested Capital</span>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>
            ${position.investedCost.toFixed(2)}
          </div>
          <span style={{ fontSize: '11px', color: '#8b949e' }}>Qty: {position.quantity.toFixed(4)}</span>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Open Duration</span>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>
            {formatDuration(position.duration)}
          </div>
        </div>
      </div>
    </div>
  );
}

