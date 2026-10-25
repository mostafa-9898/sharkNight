'use client';

import React from 'react';
import type { BacktestMetrics, MultiPositionDiagnostics } from '@/backtest/types';

interface MetricsCardsProps {
  metrics: BacktestMetrics;
  initialBalance: number;
  multiPositionDiagnostics?: MultiPositionDiagnostics;
}

export default function MetricsCards({ metrics, initialBalance, multiPositionDiagnostics }: MetricsCardsProps) {
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
    fontSize: '11px',
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
      }}
    >
      {/* 1. Total Net Profit */}
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

      {/* 2. Win Rate & Trade Counts (including Break-even) */}
      <div style={cardStyle}>
        <span style={labelStyle}>Win Rate & Break-Even</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: metrics.winRate >= 0.5 ? '#3fb950' : '#d29922' }}>
          {(metrics.winRate * 100).toFixed(1)}%
          <span style={{ fontSize: '11px', color: '#8b949e', marginLeft: '6px' }}>
            ({metrics.winningTrades}W / {metrics.losingTrades}L / {metrics.breakEvenTrades ?? 0}BE)
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

      {/* 3. Max Drawdown (Displayed ONCE, no duplicate ratio) with Duration & Recovery */}
      <div style={cardStyle}>
        <span style={labelStyle}>Max Drawdown</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#f85149' }}>
          -{metrics.maxDrawdownPercent.toFixed(1)}%
        </div>
        <div style={breakdownStyle}>
          <span>
            Duration: <strong>{metrics.maxDrawdownDurationCandles ?? 0} bars ({metrics.maxDrawdownDurationDays ?? 0}d)</strong>
          </span>
          <span>•</span>
          <span>
            Recovery: <strong>{metrics.maxDrawdownRecoveryCandles ?? 0} bars ({metrics.maxDrawdownRecoveryDays ?? 0}d)</strong>
          </span>
        </div>
      </div>

      {/* 4. Annualized Sharpe / Sortino / Calmar / CAGR */}
      <div style={cardStyle}>
        <span style={labelStyle}>Sharpe & Risk Ratios (Annualized)</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: metrics.sharpeRatio >= 1 ? '#3fb950' : '#e6edf3' }}>
          {metrics.sharpeRatio.toFixed(2)}
          <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '6px' }}>
            Sortino: <strong>{metrics.sortinoRatio?.toFixed(2) ?? '0.00'}</strong>
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>Calmar: <strong>{metrics.calmarRatio?.toFixed(2) ?? '0.00'}</strong></span>
          <span>•</span>
          <span>CAGR: <strong>{metrics.cagr !== undefined ? `${metrics.cagr > 0 ? '+' : ''}${metrics.cagr}%` : '0.00%'}</strong></span>
        </div>
      </div>

      {/* 5. Trade Return Ratio (SQN-like, unannualized) */}
      <div style={cardStyle}>
        <span style={labelStyle} title="نسبت میانگین به انحراف بازده هر معامله، سالانه‌نشده">
          Trade Return Ratio (SQN-like)
        </span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#e6edf3' }}>
          {metrics.tradeReturnRatio?.toFixed(2) ?? metrics.tradeSqnLike?.toFixed(2) ?? '0.00'}
          <span style={{ fontSize: '11px', color: '#8b949e', marginLeft: '6px' }}>
            (سالانه‌نشده)
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>Avg Trade: <strong>{metrics.averageTradeReturn > 0 ? '+' : ''}{metrics.averageTradeReturn}%</strong></span>
          <span>•</span>
          <span>Total: <strong>{metrics.totalTrades}</strong> trades</span>
        </div>
      </div>

      {/* 6. Profit Factor & Expectancy */}
      <div style={cardStyle}>
        <span style={labelStyle}>Profit Factor & Expectancy</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: (metrics.profitFactor ?? 0) >= 1.5 ? '#3fb950' : '#e6edf3' }}>
          PF: {metrics.profitFactor?.toFixed(2) ?? '0.00'}
          <span style={{ fontSize: '13px', color: '#38bdf8', marginLeft: '8px' }}>
            Exp: ${metrics.expectancy?.toFixed(2) ?? '0.00'} ({metrics.expectancyPercent?.toFixed(2) ?? '0.00'}%)
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>Long PF: <strong>{metrics.long.profitFactor?.toFixed(2) ?? '-'}</strong></span>
          <span>•</span>
          <span>Short PF: <strong>{metrics.short.profitFactor?.toFixed(2) ?? '-'}</strong></span>
          <span>•</span>
          <span>Payoff: <strong>{metrics.payoffRatio?.toFixed(2) ?? '-'}</strong></span>
        </div>
      </div>

      {/* 7. Consecutive Wins / Losses & Streaks */}
      <div style={cardStyle}>
        <span style={labelStyle}>Consecutive Streaks</span>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#e6edf3' }}>
          <span style={{ color: '#3fb950' }}>{metrics.maxConsecutiveWins ?? 0} Wins</span>
          <span style={{ color: '#8b949e', margin: '0 6px' }}>/</span>
          <span style={{ color: '#f85149' }}>{metrics.maxConsecutiveLosses ?? 0} Losses</span>
        </div>
        <div style={breakdownStyle}>
          <span>Max Cons. Loss: <strong style={{ color: '#f85149' }}>${metrics.maxConsecutiveLossesDollars?.toLocaleString() ?? '0.00'}</strong></span>
          <span>•</span>
          <span>Avg Dur: <strong>{metrics.long.averageDuration ?? 0}L / {metrics.short.averageDuration ?? 0}S bars</strong></span>
        </div>
      </div>

      {/* 8. Time in Market & Capital Exposure */}
      <div style={cardStyle}>
        <span style={labelStyle}>Time in Market & Exposure</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8' }}>
          {metrics.percentTimeInMarket?.toFixed(1) ?? '0.0'}%
          <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '6px' }}>
            in market
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>Avg Exposure: <strong>{metrics.avgExposurePercent?.toFixed(1) ?? '0.0'}%</strong></span>
          <span>•</span>
          <span>Max Conc: <strong>{multiPositionDiagnostics?.maxConcurrentPositions ?? (metrics.totalTrades > 0 ? 1 : 0)} pos</strong></span>
        </div>
      </div>

      {/* 9. Avg Win / Loss (Dual Labels: % of position size & % of capital) */}
      <div style={cardStyle}>
        <span style={labelStyle}>Avg Win/Loss (٪ از اندازه‌ی پوزیشن)</span>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#e6edf3' }}>
          <span style={{ color: '#3fb950' }}>+{metrics.averageWin ?? 0}%</span>
          <span style={{ color: '#8b949e', margin: '0 6px' }}>/</span>
          <span style={{ color: '#f85149' }}>{metrics.averageLoss ?? 0}%</span>
        </div>
        <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>
          Avg Win/Loss (٪ از سرمایه):{' '}
          <strong style={{ color: '#3fb950' }}>+{metrics.averageWinCapitalPercent ?? 0}%</strong>
          <span style={{ margin: '0 4px' }}>/</span>
          <strong style={{ color: '#f85149' }}>-{metrics.averageLossCapitalPercent ?? 0}%</strong>
        </div>
      </div>

      {/* 10. Fees, Drag & Fee % of Gross Profit */}
      <div style={cardStyle}>
        <span style={labelStyle}>Fees, Drag & Gross Share</span>
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#e6edf3' }}>
          ${metrics.totalFees?.toLocaleString() ?? '0.00'}
          <span style={{ fontSize: '12px', color: '#f85149', marginLeft: '6px' }}>
            (-{metrics.totalFeesPercent ?? 0}% drag)
          </span>
        </div>
        <div style={breakdownStyle}>
          <span>Fees % of Gross Profit: <strong>{metrics.feesPercentOfGrossProfit ?? 0}%</strong></span>
          <span>•</span>
          <span>Start: <strong>${initialBalance.toLocaleString()}</strong></span>
        </div>
      </div>
    </div>
  );
}
