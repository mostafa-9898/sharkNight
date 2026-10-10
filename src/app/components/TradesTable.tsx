'use client';

import React, { useState, useMemo } from 'react';
import type { Trade } from '@/backtest/types';

interface TradesTableProps {
  trades: Trade[];
}

type SortField =
  | 'id'
  | 'entryTime'
  | 'entryPrice'
  | 'exitTime'
  | 'exitPrice'
  | 'duration'
  | 'fee'
  | 'pnl'
  | 'pnlPercent';

type SortDirection = 'asc' | 'desc';

interface ColumnConfig {
  key: SortField;
  label: string;
  align?: 'left' | 'right' | 'center';
}

const COLUMNS: ColumnConfig[] = [
  { key: 'id', label: '#', align: 'center' },
  { key: 'entryTime', label: 'Entry Time', align: 'left' },
  { key: 'entryPrice', label: 'Entry Price', align: 'right' },
  { key: 'exitTime', label: 'Exit Time', align: 'left' },
  { key: 'exitPrice', label: 'Exit Price', align: 'right' },
  { key: 'duration', label: 'Duration', align: 'center' },
  { key: 'fee', label: 'Fee', align: 'right' },
  { key: 'pnl', label: 'Net PnL', align: 'right' },
  { key: 'pnlPercent', label: 'Return (%)', align: 'right' },
];

export default function TradesTable({ trades }: TradesTableProps) {
  // Default sorting: chronological by ID
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // For profit/return, default to descending (highest first)
      if (field === 'pnl' || field === 'pnlPercent' || field === 'duration') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };

  const resetSort = () => {
    setSortField('id');
    setSortDirection('asc');
  };

  const winningTradesCount = useMemo(() => trades.filter((t) => t.pnl > 0).length, [trades]);
  const losingTradesCount = useMemo(() => trades.filter((t) => t.pnl <= 0).length, [trades]);

  // Sort trades with useMemo
  const sortedTrades = useMemo(() => {
    const list = trades.map((trade, originalIndex) => ({
      ...trade,
      originalIndex: originalIndex + 1,
    }));

    return list.sort((a, b) => {
      let valA: number;
      let valB: number;

      switch (sortField) {
        case 'id':
          valA = a.originalIndex;
          valB = b.originalIndex;
          break;
        case 'entryTime':
          valA = a.entryTime ?? 0;
          valB = b.entryTime ?? 0;
          break;
        case 'entryPrice':
          valA = a.entryPrice;
          valB = b.entryPrice;
          break;
        case 'exitTime':
          valA = a.exitTime ?? 0;
          valB = b.exitTime ?? 0;
          break;
        case 'exitPrice':
          valA = a.exitPrice;
          valB = b.exitPrice;
          break;
        case 'duration':
          valA = a.duration ?? 0;
          valB = b.duration ?? 0;
          break;
        case 'fee':
          valA = a.fee;
          valB = b.fee;
          break;
        case 'pnl':
          valA = a.pnl;
          valB = b.pnl;
          break;
        case 'pnlPercent':
          valA = a.pnlPercent;
          valB = b.pnlPercent;
          break;
        default:
          valA = a.originalIndex;
          valB = b.originalIndex;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [trades, sortField, sortDirection]);

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
          fontSize: '13px',
        }}
      >
        No trades were executed with the specified parameters.
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
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Table Header Bar */}
      <div
        style={{
          padding: '12px 18px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          backgroundColor: '#161b22',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: '#f0f6fc', fontSize: '14px' }}>
            Trade History
          </span>
          <span
            style={{
              fontSize: '12px',
              backgroundColor: '#21262d',
              color: '#38bdf8',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 600,
            }}
          >
            {trades.length} Trades
          </span>
          <span
            style={{
              fontSize: '12px',
              backgroundColor: 'rgba(46, 160, 67, 0.15)',
              border: '1px solid rgba(46, 160, 67, 0.3)',
              color: '#3fb950',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 600,
            }}
          >
            ✓ {winningTradesCount} Win
          </span>
          <span
            style={{
              fontSize: '12px',
              backgroundColor: 'rgba(248, 81, 73, 0.15)',
              border: '1px solid rgba(248, 81, 73, 0.3)',
              color: '#f85149',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 600,
            }}
          >
            ✕ {losingTradesCount} Failed
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {sortField !== 'id' && (
            <button
              onClick={resetSort}
              style={{
                backgroundColor: '#21262d',
                color: '#8b949e',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title="Reset to default chronological order"
            >
              🔄 Reset Sort
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Table with Sticky Headers */}
      <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#0d1117', borderBottom: '1px solid #30363d' }}>
              {COLUMNS.map((col) => {
                const isSorted = sortField === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      position: 'sticky',
                      top: 0,
                      backgroundColor: '#0d1117',
                      color: isSorted ? '#38bdf8' : '#8b949e',
                      padding: '12px 14px',
                      fontWeight: 600,
                      fontSize: '12px',
                      textAlign: col.align ?? 'left',
                      cursor: 'pointer',
                      userSelect: 'none',
                      borderBottom: isSorted ? '2px solid #38bdf8' : '1px solid #30363d',
                      zIndex: 2,
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                    title={`Sort by ${col.label}`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span>{col.label}</span>
                      <span
                        style={{
                          fontSize: '11px',
                          color: isSorted ? '#38bdf8' : '#484f58',
                          fontWeight: 700,
                        }}
                      >
                        {isSorted ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((trade, idx) => {
              const isProfit = trade.pnl >= 0;
              return (
                <tr
                  key={idx}
                  style={{
                    borderBottom: '1px solid #21262d',
                    backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                    transition: 'background-color 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)';
                  }}
                >
                  {/* # */}
                  <td
                    style={{
                      padding: '10px 14px',
                      color: '#8b949e',
                      textAlign: 'center',
                      fontWeight: sortField === 'id' ? 700 : 400,
                    }}
                  >
                    {trade.originalIndex}
                  </td>

                  {/* Entry Time */}
                  <td
                    style={{
                      padding: '10px 14px',
                      whiteSpace: 'nowrap',
                      color: sortField === 'entryTime' ? '#f0f6fc' : '#c9d1d9',
                    }}
                  >
                    {formatTime(trade.entryTime)}
                  </td>

                  {/* Entry Price */}
                  <td
                    style={{
                      padding: '10px 14px',
                      textAlign: 'right',
                      fontWeight: 500,
                      color: sortField === 'entryPrice' ? '#f0f6fc' : '#e6edf3',
                    }}
                  >
                    ${trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>

                  {/* Exit Time */}
                  <td
                    style={{
                      padding: '10px 14px',
                      whiteSpace: 'nowrap',
                      color: sortField === 'exitTime' ? '#f0f6fc' : '#c9d1d9',
                    }}
                  >
                    {formatTime(trade.exitTime)}
                  </td>

                  {/* Exit Price */}
                  <td
                    style={{
                      padding: '10px 14px',
                      textAlign: 'right',
                      fontWeight: 500,
                      color: sortField === 'exitPrice' ? '#f0f6fc' : '#e6edf3',
                    }}
                  >
                    ${trade.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>

                  {/* Duration */}
                  <td
                    style={{
                      padding: '10px 14px',
                      color: '#8b949e',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatDuration(trade.duration)}
                  </td>

                  {/* Fee */}
                  <td
                    style={{
                      padding: '10px 14px',
                      color: '#8b949e',
                      textAlign: 'right',
                    }}
                  >
                    ${trade.fee.toFixed(2)}
                  </td>

                  {/* Net PnL */}
                  <td
                    style={{
                      padding: '10px 14px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: isProfit ? '#3fb950' : '#f85149',
                      backgroundColor:
                        sortField === 'pnl'
                          ? isProfit
                            ? 'rgba(46, 160, 67, 0.08)'
                            : 'rgba(248, 81, 73, 0.08)'
                          : 'transparent',
                    }}
                  >
                    {isProfit ? '+' : ''}${trade.pnl.toFixed(2)}
                  </td>

                  {/* Return % */}
                  <td
                    style={{
                      padding: '10px 14px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: isProfit ? '#3fb950' : '#f85149',
                      backgroundColor:
                        sortField === 'pnlPercent'
                          ? isProfit
                            ? 'rgba(46, 160, 67, 0.08)'
                            : 'rgba(248, 81, 73, 0.08)'
                          : 'transparent',
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
