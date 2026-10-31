import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PaperReporter, PAPER_MARKETS } from '../../src/paper/report';
import { PaperRunner, BOOK_A_SPEC, BOOK_B_SPEC } from '../../src/paper/runner';
import type { Candle } from '../../src/data/models/candle';

describe('PaperReporter (PT3)', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-report-test-'));
    outputDir = path.join(tempDir, 'docs');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('generates comprehensive markdown report with exact numeric parity with states', async () => {
    // 1. Prepare candle fixtures for 4 markets
    const raw1h: Candle[] = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), 'data/BTCUSDT_1h.json'), 'utf-8')
    );
    const raw4h: Candle[] = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), 'data/BTCUSDT_4h.json'), 'utf-8')
    );

    const slice1h = raw1h.slice(10000, 10500);
    const slice4h = raw4h.slice(2500, 2700);

    const candlesMap: Record<string, Candle[]> = {
      'BTCUSDT_1h': slice1h,
      'BTCUSDT_4h': slice4h,
      'ETHUSDT_1h': slice1h,
      'ETHUSDT_4h': slice4h,
    };

    const runner = new PaperRunner({ dataDir: tempDir, initialBalance: 10000 });

    // Process all markets for Book A and Book B
    for (const m of PAPER_MARKETS) {
      const c = candlesMap[`${m.symbol}_${m.interval}`];
      await runner.processCandles({
        book: 'A',
        symbol: m.symbol,
        interval: m.interval,
        candles: c,
        closePositionsAtEnd: false,
      });

      await runner.processCandles({
        book: 'B',
        symbol: m.symbol,
        interval: m.interval,
        candles: c,
        closePositionsAtEnd: false,
      });
    }

    const reporter = new PaperReporter({ dataDir: tempDir });
    const { markdown, filePath } = await reporter.generateMarkdownReport({
      outputDir,
      candlesMap,
    });

    // Verify file written to disk
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    // Verify all core sections exist
    expect(markdown).toContain('## ۱. مقایسه عملکرد کل دو دفتر (Book A vs Book B)');
    expect(markdown).toContain('## ۲. تفکیک عملکرد بازارهای ۴‌گانه');
    expect(markdown).toContain('## ۳. فهرست پوزیشن‌های باز فعلی');
    expect(markdown).toContain('## ۴. گزارش معاملات بسته‌شده');
    expect(markdown).toContain('## ۵. تفکیک فانل سیگنال‌ها (Signal Funnel)');
    expect(markdown).toContain('## ۶. بازپخش روزانه با موتور بک‌تست (بررسی انحراف صفر)');
    expect(markdown).toContain('## ۷. وضعیت احراز شرایط پیش‌ثبت');

    // Verify calculateMetrics fields are present
    expect(markdown).toContain('نرخ شارپ روزانه (Sharpe)');
    expect(markdown).toContain('فاکتور سود (Profit Factor)');
    expect(markdown).toContain('امید ریاضی (Expectancy $/tr)');
    expect(markdown).toContain('نرخ رشد سالانه (CAGR %)');
    expect(markdown).toContain('بیشینه افت سرمایه (Max DD %)');
    expect(markdown).toContain('نسبت Return / DD');

    // Verify zero deviation check
    expect(markdown).toContain('ZERO DEVIATION (PASS)');

    // Verify consistency: read state file and ensure values in markdown match state exactly
    const stateA_Btc1h = await runner.loadState('A', 'BTCUSDT', '1h');
    expect(stateA_Btc1h).not.toBeNull();
    const retPercentStr = `${stateA_Btc1h ? ((stateA_Btc1h.equity - stateA_Btc1h.initialBalance) / stateA_Btc1h.initialBalance * 100).toFixed(2) : ''}%`;
    expect(markdown).toContain(retPercentStr);
  });

  it('verifies replay deviation produces zero deviation on identical candles', async () => {
    const raw1h: Candle[] = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), 'data/BTCUSDT_1h.json'), 'utf-8')
    );
    const slice = raw1h.slice(10000, 10300);

    const runner = new PaperRunner({ dataDir: tempDir, initialBalance: 10000 });
    await runner.processCandles({
      book: 'A',
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: slice,
      closePositionsAtEnd: false,
    });

    const reporter = new PaperReporter({ dataDir: tempDir });
    const replays = await reporter.verifyReplayDeviation('A', { 'BTCUSDT_1h': slice });
    const btc1hReplay = replays.find((r) => r.symbol === 'BTCUSDT' && r.interval === '1h');

    expect(btc1hReplay).toBeDefined();
    expect(btc1hReplay?.zeroDeviation).toBe(true);
    expect(btc1hReplay?.pnlDifference).toBe(0);
  });
});

