import type { Candle, CandleRequest } from '../models';

export interface DataProvider {
  readonly name: string;
  fetchCandles(request: CandleRequest): Promise<Candle[]>;
}
