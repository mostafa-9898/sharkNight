import { KucoinPublicProvider } from '@/data/providers/kucoin-public';

describe('KucoinPublicProvider', () => {
  const sampleKucoinRow = (timeSec: number, price: number) => [
    timeSec.toString(),
    price.toString(),
    (price + 2).toString(), // close
    (price + 5).toString(), // high
    (price - 5).toString(), // low
    '15.5',                 // volume
    '120000',               // turnover
  ];

  it('should initialize with correct default name and base URL', () => {
    const provider = new KucoinPublicProvider();
    expect(provider.name).toBe('kucoin-public');
  });

  it('should correctly format symbols and fetch candles from KuCoin API', async () => {
    const rows = [
      sampleKucoinRow(1600000000, 100),
      sampleKucoinRow(1600003600, 105),
    ];

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: '200000',
        data: rows,
      }),
    });

    const provider = new KucoinPublicProvider({
      baseUrl: 'https://test-api.kucoin.com',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const candles = await provider.fetchCandles({
      symbol: 'BTCUSDT',
      interval: '1h',
      limit: 10,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain('https://test-api.kucoin.com/api/v1/market/candles');
    expect(callUrl).toContain('symbol=BTC-USDT');
    expect(callUrl).toContain('type=1hour');

    expect(candles).toHaveLength(2);
    expect(candles[0].open).toBe(100);
    expect(candles[0].close).toBe(102);
    expect(candles[0].high).toBe(105);
    expect(candles[0].low).toBe(95);
  });

  it('should throw an error when KuCoin returns an error code', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: '400001',
        msg: 'Symbol does not exist',
      }),
    });

    const provider = new KucoinPublicProvider({ fetchFn: mockFetch as unknown as typeof fetch });

    await expect(
      provider.fetchCandles({ symbol: 'UNKNOWN', interval: '1h' })
    ).rejects.toThrow('Symbol does not exist');
  });
});

