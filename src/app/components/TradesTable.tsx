'use client';

import React from 'react';
import type { Trade } from '@/backtest/types';

interface TradesTableProps {
  trades: Trade[];
}

export default function TradesTable({ trades }: TradesTableProps) {
  if (trades.length === 0) {
    return (
      <div
        style={{
          backgroundColor: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '24px',
          textAlign: 'center',
          color: '#8b949e',
        }}
      >
        No trades were triggered by this strategy for the given parameters and time range.
      </div>
    );
  }

  const formatTime = (ts?: number) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <div
      style={{
        backgroundColor: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 600, color: '#f0f6fc' }}>Trade History ({trades.length} Trades)</span>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '360px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#0d1117', color: '#8b949e', borderBottom: '1px solid #30363d' }}>
              <th style={{ padding: '10px 14px' }}>#</th>
              <th style={{ padding: '10px 14px' }}>Entry Time</th>
              <th style={{ padding: '10px 14px' }}>Entry Price</th>
              <th style={{ padding: '10px 14px' }}>Exit Time</th>
              <th style={{ padding: '10px 14px' }}>Exit Price</th>
              <th style={{ padding: '10px 14px' }}>Duration</th>
              <th style={{ padding: '10px 14px' }}>Fee</th>
              <th style={{ padding: '10px 14px' }}>Net PnL</th>
              <th style={{ padding: '10px 14px' }}>Return</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, idx) => {
              const isProfit = trade.pnl >= 0;
              return (
                <tr
                  key={idx}
                  style={{
                    borderBottom: '1px solid #21262d',
                    backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                  }}
                >
                  <td style={{ padding: '10px 14px', color: '#8b949e' }}>{idx + 1}</td>
                  <td style={{ padding: '10px 14px' }}>{formatTime(trade.entryTime)}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 500 }}>${trade.entryPrice.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px' }}>{formatTime(trade.exitTime)}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 500 }}>${trade.exitPrice.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', color: '#8b949e' }}>{formatDuration(trade.duration)}</td>
                  <td style={{ padding: '10px 14px', color: '#8b949e' }}>${trade.fee.toFixed(2)}</td>
                  <td
                    style={{
                      padding: '10px 14px',
                      fontWeight: 600,
                      color: isProfit ? '#3fb950' : '#f85149',
                    }}
                  >
                    {isProfit ? '+' : ''}${trade.pnl.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: '10px 14px',
                      fontWeight: 600,
                      color: isProfit ? '#3fb950' : '#f85149',
                    }}
                  >
                    {isProfit ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

