import * as fs from 'fs';
import * as path from 'path';
import { detrendCandles } from '../../src/scripts/run-rc4-detrend';
import type { Candle } from '../../src/data/models';

describe('Real Data Detrending & Mirror Symmetry (RC4 - H-F)', () => {
  it('verifies that detrendCandles removes mean log-return exactly (end price equals start price)', () => {
    // 10 candles with clear upward trend
    const candles: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 20; i++) {
      p *= 1.05; // 5% growth per candle
      candles.push({
        timestamp: 1000 + i * 60000,
        open: p,
        high: p * 1.01,
        low: p * 0.99,
        close: p,
        volume: 1000,
      });
    }

    const detrended = detrendCandles(candles);
    expect(detrended).toHaveLength(20);
    expect(detrended[0].close).toBe(candles[0].close);

    // End price must equal start price (zero cumulative return)
    const logReturnTotal = Math.log(detrended[detrended.length - 1].close / detrended[0].close);
    expect(Math.abs(logReturnTotal)).toBeLessThan(1e-4);
  });

  it('verifies that rc4_detrend_data.json exists and confirms upward drift impact on shorts', () => {
    const jsonPath = path.resolve('docs/review/rc4_detrend_data.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(data['BTC 15m']).toBeDefined();
    expect(data['BTC 1h']).toBeDefined();
    expect(data['BTC 4h']).toBeDefined();
    expect(data['ETH 15m']).toBeDefined();
    expect(data['ETH 1h']).toBeDefined();
    expect(data['ETH 4h']).toBeDefined();

    // Verify that detrending improves short performance significantly
    const btc15mOrig = data['BTC 15m'].original.shortReturn;
    const btc15mDetrend = data['BTC 15m'].detrended.shortReturn;
    expect(btc15mDetrend).toBeGreaterThan(btc15mOrig);
  });
});
