import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from '../strategies/types';

export type TradeMode = 'long-short' | 'long-only' | 'short-only';
export type TradeSide = 'long' | 'short';
export type ExitReason =
  | 'signal'
  | 'reverse'
  | 'takeProfit'
  | 'stopLoss'
  | 'trailingStop'
  | 'end'
  | 'tkCrossExit'
  | 'kijunExit'
  | 'timeStop';
export type ExitMode = 'reverse' | 'tkCross' | 'kijun' | 'trailingOnly';
export type StopCheckMode = 'intrabar' | 'close';

export interface TrailingStopConfig {
  initialStopPercent: number; // e.g., 5 for 5% initial stop below/above entry
  stepPercent: number;        // e.g., 10 for each 10% favorable move
  raisePercent: number;       // e.g., 5 for 5% stop raise per step
  mode?: 'trend' | 'stepped'; // 'trend' (follows trend peaks, non-retreating) or 'stepped' (ratchet steps)
}

export type CloudLocation = 'above' | 'inside' | 'below';

export interface EntryDiagnostics {
  side: TradeSide;
  priceVsCloud: CloudLocation;
  tkCrossVsCloud: CloudLocation;
  cloudThicknessPercent: number;
  rsiAtEntry: number;
  rsiHitValue: number;
  rsiHitAge: number;
  kijunSlope: number;
  atrPercentile: number;
  distanceFromKijunAtr: number;
  hourOfDayUtc: number;
  dayOfWeek: number;
}

export interface TkCrossTraceEvent {
  index: number;
  timestamp: number;
  direction: 'up' | 'down';
  price: number;
  rsi: number;
  inRsiZone: boolean;
  filterRejection?: 'cloudFilter' | 'rsiRecoveryCap' | 'rsiOutOfZone' | 'kijunSlopeFilter';
  signalEmitted: boolean;
  rsiHitIndex?: number;
  rsiHitValue?: number;
  rsiHitAge?: number;
}

export interface IgnoredSignalTraceEvent {
  index: number;
  timestamp: number;
  signal: TradeSignal;
  reason:
    | 'alreadyInPosition'
    | 'longOnlyShortIgnored'
    | 'shortOnlyLongIgnored'
    | 'cap_positions'
    | 'cap_exposure'
    | 'min_bars';
}

export interface BacktestTrace {
  tkCrossEvents: TkCrossTraceEvent[];
  ignoredSignals: IgnoredSignalTraceEvent[];
}

export interface BacktestConfig {
  strategy: Strategy;
  candles: readonly Candle[];
  initialBalance: number;
  tradeFeePercent?: number;       // e.g., 0.1 for 0.1%
  positionSizePercent?: number;   // e.g., 100 for 100% of balance (or cap when riskPerTradePercent is set)
  riskPerTradePercent?: number;   // e.g., 1 for 1% risk of account on initial stop
  tradeMode?: TradeMode;          // DEFAULT: 'long-short'
  exitMode?: ExitMode;            // DEFAULT: 'reverse'
  maxBarsInTrade?: number;        // time stop in candles (optional)
  takeProfitPercent?: number;     // e.g., 5 for 5% TP
  stopLossPercent?: number;       // e.g., 3 for 3% SL
  trailingStop?: TrailingStopConfig;
  maxOpenPositions?: number;       // DEFAULT: 1
  maxTotalExposurePercent?: number;// DEFAULT: 100
  minBarsBetweenEntries?: number;  // DEFAULT: 0
  slippagePercent?: number;       // default 0, applied adversely on stop/TP exits
  stopCheckMode?: StopCheckMode;  // default 'intrabar'
  collectTrace?: boolean;         // optional passive trace collector
}

export type StopUpdateReason =
  | 'initialStop'
  | 'dynamicStop'
  | 'breakEven'
  | 'trendTrail'
  | 'steppedRatchet';

export interface StopUpdateEvent {
  positionId?: number;
  tradeId?: number;
  side: TradeSide;
  timestamp: number;
  candleIndex?: number;
  stopPriceBefore: number | null;
  candidateStopPrice: number;
  acceptedStopPrice: number;
  reason: StopUpdateReason;
  trailingMode?: 'trend' | 'stepped';
  ratchetSteps: number;
  accepted: boolean;
}

export interface Trade {
  side: TradeSide;
  exitReason: ExitReason;
  entrySignal: TradeSignal;
  exitSignal: TradeSignal;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  fee: number;
  entryTime?: number;
  exitTime?: number;
  duration?: number;
  maxFavorablePercent: number;    // Best unrealized favorable move (% of entry price)
  maxAdversePercent: number;      // Worst unrealized adverse move (% of entry price)
  stopPrice?: number;             // Stop level at time of exit (if stopped out or tracked)
  initialStopPrice?: number;      // Initial stop price upon entry
  initialStopPercent?: number;    // Initial stop loss % upon entry
  stopHistory?: StopUpdateEvent[];// Recorded chronological stop price lifecycle
  ratchetSteps?: number;          // Number of trailing ratchet steps reached
  entryDiagnostics?: EntryDiagnostics;
  positionId?: number;
  concurrentOpenAtEntry?: number;
}


export interface ActivePosition {
  symbol?: string;
  side: TradeSide;
  entrySignal: TradeSignal;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  investedCost: number;
  entryFee: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryTime: number;
  duration: number;
}

export interface SideMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;                // 0-1
  totalPnl: number;
  totalPnlPercent: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;                // 0-1
  totalPnl: number;
  totalPnlPercent: number;
  maxDrawdown: number;            // 0-1
  maxDrawdownPercent: number;
  sharpeRatio: number;
  averageTradeReturn: number;
  bestTrade: number;
  worstTrade: number;
  finalBalance: number;
  totalFees: number;              // Absolute fees paid across all trades
  totalFeesPercent: number;       // Total fees paid as % of initial balance
  averageWin: number;             // Average return % of winning trades
  averageLoss: number;            // Average return % of losing trades
  feeDragPercent: number;         // Total fee drag (% of initial balance)
  long: SideMetrics;
  short: SideMetrics;
}

export interface MfeMaeDistribution {
  count: number;
  mfeThresholds: Record<string, number>; // Share (%) of trades whose MFE >= threshold
  mfeMedian: number;
  mfeP75: number;
  mfeP90: number;
  maeMedian: number;
  maeP75: number;
  maeP90: number;
}

export interface MfeMaeAnalysis {
  all: MfeMaeDistribution;
  long: MfeMaeDistribution;
  short: MfeMaeDistribution;
}

export interface MultiPositionDiagnostics {
  avgConcurrentPositions: number;
  maxConcurrentPositions: number;
  percentTimeAtCapacity: number;
  rejectedSignals: {
    cap_positions: number;
    cap_exposure: number;
    min_bars: number;
  };
}

export interface BacktestResult {
  config: Omit<BacktestConfig, 'candles'>;
  trades: Trade[];
  metrics: BacktestMetrics;
  equity: number[];               // Equity curve over time
  activePosition?: ActivePosition | null;
  trace?: BacktestTrace;
  multiPositionDiagnostics?: MultiPositionDiagnostics;
  stopUpdates?: StopUpdateEvent[];
}
