import { BinancePublicProvider } from '@/data/providers/binance-public';

describe('BinancePublicProvider', () => {
  const sampleKlineRow = (time: number, price: number) => [
    time,
    price.toString(),
    (price + 5).toString(),
    (price - 5).toString(),
    price.toString(),
    '100.5',
    time + 59999,
    '5000',
    50,
    '40',
    '2000',
    '0',
  ];

  it('should initialize with correct default name and base URL', () => {
    const provider = new BinancePublicProvider();
    expect(provider.name).toBe('binance-public');
  });

  it('should throw error if symbol is empty', async () => {
    const provider = new BinancePublicProvider();
    await expect(
      provider.fetchCandles({ symbol: '   ', interval: '1h' })
    ).rejects.toThrow('Symbol cannot be empty');
  });

  it('should return empty array if limit is zero or negative', async () => {
    const mockFetch = jest.fn();
    const provider = new BinancePublicProvider({ fetchFn: mockFetch as unknown as typeof fetch });

    const result = await provider.fetchCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 0 });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should successfully fetch and map klines from Binance API', async () => {
    const rows = [
      sampleKlineRow(1600000000000, 100),
      sampleKlineRow(1600000060000, 102),
    ];

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => rows,
    });

    const provider = new BinancePublicProvider({
      baseUrl: 'https://test-api.binance.com',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const candles = await provider.fetchCandles({
      symbol: 'btcusdt',
      interval: '1m',
      limit: 10,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain('https://test-api.binance.com/api/v3/klines');
    expect(callUrl).toContain('symbol=BTCUSDT');
    expect(callUrl).toContain('interval=1m');
    expect(callUrl).toContain('limit=10');

    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({
      timestamp: 1600000000000,
      open: 100,
      high: 105,
      low: 95,
      close: 100,
      volume: 100.5,
    });
  });

  it('should handle forward pagination when startTime is provided and limit exceeds 1000', async () => {
    // Generate 1000 rows for batch 1
    const batch1 = Array.from({ length: 1000 }, (_, i) =>
      sampleKlineRow(1000000 + i * 60000, 100)
    );
    // Generate 200 rows for batch 2
    const batch2 = Array.from({ length: 200 }, (_, i) =>
      sampleKlineRow(1000000 + (1000 + i) * 60000, 105)
    );

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => batch1,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => batch2,
      });

    const provider = new BinancePublicProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const candles = await provider.fetchCandles({
      symbol: 'ETHUSDT',
      interval: '1m',
      startTime: 1000000,
      limit: 1200,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(candles).toHaveLength(1200);

    // Verify second request starts after the last candle of batch 1
    const secondCallUrl = mockFetch.mock.calls[1][0] as string;
    const lastBatch1Time = 1000000 + 999 * 60000;
    expect(secondCallUrl).toContain(`startTime=${lastBatch1Time + 1}`);
  });

  it('should handle backward pagination when startTime is NOT provided and limit exceeds 1000', async () => {
    // Batch 1: returns most recent 1000 candles [2000000 to 2000000 + 999 * 60000]
    const batch1 = Array.from({ length: 1000 }, (_, i) =>
      sampleKlineRow(2000000 + i * 60000, 100)
    );
    // Batch 2: returns older 200 candles [1988000 to 1999940]
    const batch2 = Array.from({ length: 200 }, (_, i) =>
      sampleKlineRow(1988000 + i * 60000, 95)
    );

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => batch1,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => batch2,
      });

    const provider = new BinancePublicProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const candles = await provider.fetchCandles({
      symbol: 'BTCUSDT',
      interval: '1m',
      limit: 1200,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(candles).toHaveLength(1200);

    // Verify first request had no startTime and no endTime
    const firstCallUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstCallUrl).not.toContain('startTime=');
    expect(firstCallUrl).not.toContain('endTime=');

    // Verify second request uses endTime = batch1[0].timestamp - 1 (oldest candle - 1)
    const secondCallUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondCallUrl).not.toContain('startTime=');
    expect(secondCallUrl).toContain(`endTime=${2000000 - 1}`);

    // Verify candles are sorted ascending chronologically
    expect(candles[0].timestamp).toBe(1988000);
    expect(candles[candles.length - 1].timestamp).toBe(2000000 + 999 * 60000);
  });

  it('should throw an error with status and text when response is not ok', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"code":-1121,"msg":"Invalid symbol."}',
    });

    const provider = new BinancePublicProvider({ fetchFn: mockFetch as unknown as typeof fetch });

    await expect(
      provider.fetchCandles({ symbol: 'INVALID', interval: '1h' })
    ).rejects.toThrow('Binance API error (status 400): {"code":-1121,"msg":"Invalid symbol."}');
  });

  it('should throw descriptive error on network failure', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network offline'));
    const provider = new BinancePublicProvider({ fetchFn: mockFetch as unknown as typeof fetch });

    await expect(
      provider.fetchCandles({ symbol: 'BTCUSDT', interval: '1h' })
    ).rejects.toThrow('Failed to fetch candles from Binance API: Network offline');
  });
});

