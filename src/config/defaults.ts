import type { TradeMode, ExitMode, StopCheckMode, TrailingStopConfig } from '../backtest/types';

export const DEFAULT_TRADE_MODE: TradeMode = 'long-short';
export const DEFAULT_EXIT_MODE: ExitMode = 'trailingOnly';
export const DEFAULT_TRAILING_STOP_ENABLED = true;
export const DEFAULT_TRAILING_MODE: 'stepped' | 'trend' = 'stepped';

export const DEFAULT_INITIAL_STOP_PERCENT = 5.0;
export const DEFAULT_TRAIL_STEP_PERCENT = 3.0;
export const DEFAULT_TRAIL_RAISE_PERCENT = 1.5;

export const DEFAULT_TRAILING_STOP: TrailingStopConfig = {
  initialStopPercent: DEFAULT_INITIAL_STOP_PERCENT,
  stepPercent: DEFAULT_TRAIL_STEP_PERCENT,
  raisePercent: DEFAULT_TRAIL_RAISE_PERCENT,
  mode: DEFAULT_TRAILING_MODE,
};

export const DEFAULT_MAX_OPEN_POSITIONS = 10;
export const DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT = 30;
export const DEFAULT_POSITION_SIZE_PERCENT = 3;
export const DEFAULT_MIN_BARS_BETWEEN_ENTRIES = 0;

export const DEFAULT_FISHER_MODE: 'off' | 'extra-trigger' | 'replace-stoch' | 'confirm' = 'confirm';
export const DEFAULT_FISHER_KIND: 'fisher' | 'ift' = 'fisher';
export const DEFAULT_OSCILLATOR_DISPLAY: 'rsi' | 'fisher' | 'ift' = 'fisher';

export const DEFAULT_INITIAL_BALANCE = 10000;
export const DEFAULT_TRADE_FEE_PERCENT = 0.1;
export const DEFAULT_SLIPPAGE_PERCENT = 0;
export const DEFAULT_STOP_CHECK_MODE: StopCheckMode = 'intrabar';
export const DEFAULT_KIJUN_SLOPE_FILTER = true;
export const DEFAULT_STRUCTURE_FILTER = true;

export const DEFAULT_SYMBOL = 'BTCUSDT';
export const DEFAULT_INTERVAL = '4h';
export const DEFAULT_PERIOD = '6y';
