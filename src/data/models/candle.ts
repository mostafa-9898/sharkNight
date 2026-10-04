export interface Candle {
  timestamp: number;      // Unix timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleRequest {
  symbol: string;          // e.g., 'BTCUSDT'
  interval: CandleInterval;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
