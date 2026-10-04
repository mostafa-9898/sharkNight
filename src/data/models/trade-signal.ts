export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface TradeSignal {
  action: SignalAction;
  timestamp: number;
  price: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}
