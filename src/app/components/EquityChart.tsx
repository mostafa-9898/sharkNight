'use client';

import React, { useMemo, useState } from 'react';
import type { Candle } from '@/data/models/candle';

interface EquityChartProps {
  candles: Candle[];
  equity: number[];
  initialBalance: number;
}

export default function EquityChart({
  candles,
  equity,
  initialBalance,
}: EquityChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Downsample to ~350 evenly spaced points so the entire 6-year history fits in one view
  const sampledData = useMemo(() => {
    if (!equity || equity.length === 0) return [];
    const count = equity.length;
    const maxPoints = 350;
    const step = Math.max(1, Math.floor(count / maxPoints));

    const points: { time: number; value: number }[] = [];
    for (let i = 0; i < count; i += step) {
      const candle = candles[i] || candles[candles.length - 1];
      points.push({
        time: candle ? candle.timestamp : i,
        value: equity[i],
      });
    }

    // Always include the final point
    const lastIdx = count - 1;
    if (points.length === 0 || points[points.length - 1].time !== candles[lastIdx]?.timestamp) {
      points.push({
        time: candles[lastIdx]?.timestamp ?? lastIdx,
        value: equity[lastIdx],
      });
    }

    return points;
  }, [candles, equity]);

  const stats = useMemo(() => {
    if (!equity || equity.length === 0) {
      return { finalBalance: initialBalance, netReturnPercent: 0, peak: initialBalance, trough: initialBalance };
    }
    const finalBalance = equity[equity.length - 1];
    const netReturnPercent = ((finalBalance - initialBalance) / initialBalance) * 100;
    let peak = equity[0];
    let trough = equity[0];
    for (let i = 1; i < equity.length; i++) {
      const val = equity[i];
      if (val > peak) peak = val;
      if (val < trough) trough = val;
    }
    return { finalBalance, netReturnPercent, peak, trough };
  }, [equity, initialBalance]);

  if (sampledData.length < 2) {
    return null;
  }

  // Chart dimensions in SVG coordinates
  const svgWidth = 1000;
  const svgHeight = 220;
  const padding = { top: 20, right: 30, bottom: 30, left: 60 };

  const plotWidth = svgWidth - padding.left - padding.right;
  const plotHeight = svgHeight - padding.top - padding.bottom;

  const minVal = Math.min(stats.trough, initialBalance) * 0.96;
  const maxVal = Math.max(stats.peak, initialBalance) * 1.04;
  const valRange = maxVal - minVal || 1;

  const getX = (index: number) => padding.left + (index / (sampledData.length - 1)) * plotWidth;
  const getY = (val: number) => padding.top + plotHeight - ((val - minVal) / valRange) * plotHeight;

  // Build SVG polyline points and fill polygon
  const linePoints = sampledData.map((d, i) => `${getX(i).toFixed(1)},${getY(d.value).toFixed(1)}`).join(' ');
  const areaPoints = `${linePoints} ${getX(sampledData.length - 1).toFixed(1)},${(padding.top + plotHeight).toFixed(1)} ${getX(0).toFixed(1)},${(padding.top + plotHeight).toFixed(1)}`;

  const baselineY = getY(initialBalance);
  const isProfit = stats.netReturnPercent >= 0;
  const mainColor = isProfit ? '#2ea043' : '#f85149';

  // Y-axis grid levels (4 ticks)
  const yTicks = [
    minVal,
    minVal + valRange * 0.33,
    minVal + valRange * 0.66,
    maxVal,
  ];

  // X-axis date labels (5 ticks)
  const xTickIndices = [
    0,
    Math.floor(sampledData.length * 0.25),
    Math.floor(sampledData.length * 0.5),
    Math.floor(sampledData.length * 0.75),
    sampledData.length - 1,
  ];

  const hoveredPoint = hoverIndex !== null && sampledData[hoverIndex] ? sampledData[hoverIndex] : null;

  return (
    <div
      style={{
        backgroundColor: '#161b22',
        borderRadius: '8px',
        border: '1px solid #30363d',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 700, color: '#f0f6fc', fontSize: '14px' }}>
            📈 Portfolio Equity Curve
          </span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: isProfit ? 'rgba(46, 160, 67, 0.15)' : 'rgba(248, 81, 73, 0.15)',
              color: mainColor,
            }}
          >
            {isProfit ? '+' : ''}
            {stats.netReturnPercent.toFixed(2)}%
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
          <span style={{ color: '#8b949e' }}>
            Initial: <strong style={{ color: '#f0f6fc' }}>${initialBalance.toLocaleString()}</strong>
          </span>
          <span style={{ color: '#8b949e' }}>
            Peak: <strong style={{ color: '#38bdf8' }}>${Math.round(stats.peak).toLocaleString()}</strong>
          </span>
          <span style={{ color: '#8b949e' }}>
            Final: <strong style={{ color: mainColor }}>${Math.round(stats.finalBalance).toLocaleString()}</strong>
          </span>
        </div>
      </div>

      {/* Responsive One-Screen SVG Chart */}
      <div style={{ position: 'relative', width: '100%', height: '220px', padding: '6px 8px' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%', display: 'block' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const fraction = Math.max(0, Math.min(1, (mouseX - (padding.left / svgWidth) * rect.width) / ((plotWidth / svgWidth) * rect.width)));
            const idx = Math.round(fraction * (sampledData.length - 1));
            setHoverIndex(idx);
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={mainColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={mainColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Grid lines (horizontal) */}
          {yTicks.map((tick, i) => {
            const y = getY(tick);
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={svgWidth - padding.right}
                  y2={y}
                  stroke="#21262d"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  fill="#8b949e"
                  fontSize="11"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  ${Math.round(tick).toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* Baseline (Initial Balance) */}
          <line
            x1={padding.left}
            y1={baselineY}
            x2={svgWidth - padding.right}
            y2={baselineY}
            stroke="#8b949e"
            strokeWidth="1.2"
            strokeDasharray="4 4"
            opacity="0.6"
          />

          {/* Area fill */}
          <polygon points={areaPoints} fill="url(#equityGrad)" />

          {/* Line curve */}
          <polyline
            points={linePoints}
            fill="none"
            stroke={mainColor}
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* X-axis date labels */}
          {xTickIndices.map((idx) => {
            const pt = sampledData[idx];
            if (!pt) return null;
            const x = getX(idx);
            const dateStr = new Date(pt.time).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            });
            return (
              <text
                key={idx}
                x={x}
                y={svgHeight - 8}
                fill="#8b949e"
                fontSize="11"
                textAnchor="middle"
              >
                {dateStr}
              </text>
            );
          })}

          {/* Active Hover Crosshair & Point */}
          {hoverIndex !== null && hoveredPoint && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={padding.top}
                x2={getX(hoverIndex)}
                y2={padding.top + plotHeight}
                stroke="#38bdf8"
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
              <circle
                cx={getX(hoverIndex)}
                cy={getY(hoveredPoint.value)}
                r="4.5"
                fill="#38bdf8"
                stroke="#161b22"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoverIndex !== null && hoveredPoint && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: `${Math.min(85, Math.max(15, (getX(hoverIndex) / svgWidth) * 100))}%`,
              transform: 'translateX(-50%)',
              backgroundColor: '#0d1117',
              border: '1px solid #38bdf8',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#f0f6fc',
              pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <span style={{ color: '#8b949e' }}>
              {new Date(hoveredPoint.time).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span style={{ color: hoveredPoint.value >= initialBalance ? '#2ea043' : '#f85149' }}>
              ${Math.round(hoveredPoint.value).toLocaleString()} (
              {hoveredPoint.value >= initialBalance ? '+' : ''}
              {(((hoveredPoint.value - initialBalance) / initialBalance) * 100).toFixed(1)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
