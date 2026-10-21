import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { BacktestEngine } from '../backtest/engine';
import { MultiTimeframeStrategy } from '../strategies/multi-timeframe-strategy';
import type { Candle } from '../data/models';
import { roundTo } from '../utils/math';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

async function loadGzCandles(filePath: string): Promise<Candle[]> {
  const compressed = await fs.readFile(filePath);
  const uncompressed = await gunzip(compressed);
  const text = uncompressed.toString('utf-8');
  const lines = text.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [timestamp, open, high, low, close, volume] = line.split(',');
    candles.push({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}

export interface SimTradeRecord {
  market: string;
  symbol: string;
  tf: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
}

interface PortfolioPosition {
  symbol: string;
  market: string;
  tf: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryCost: number;
  entryFee: number;
}

export interface PortfolioSimResult {
  version: 'P1' | 'P2' | 'P3';
  totalReturnPct: number;
  maxDrawdownPct: number;
  yearlyReturns: Record<number, number>;
  executedTrades: number;
  rejectedTrades: number;
  rejectedReasons: {
    symbolOccupied: number;
    capExposure: number;
    brakeActive: number;
  };
  maxConcurrentNotionalUSD: number;
  maxConcurrentEntryNotionalPct: number;
  maxDailyMtmNotionalPct: number;
  returnWithoutTop3Pct: number;
  pass: boolean;
  dailyEquity: Array<{
    date: string;
    equity: number;
    drawdownPct: number;
  }>;
}

export async function runPortfolioSimulation(): Promise<void> {
  console.log('=== Step 7: Portfolio Simulator on D* (12 Markets, $10,000 Capital) ===');

  const rootDir = process.cwd();
  const dataDir = path.resolve(rootDir, 'docs', 'review', 'data');
  const outDir = path.resolve(rootDir, 'docs', 'review', 'validation');
  await fs.mkdir(outDir, { recursive: true });

  const symbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA'] as const;
  const intervals = ['1h', '4h'] as const;
  const years = [2021, 2022, 2023, 2024, 2025, 2026] as const;

  // 1. Load candles
  console.log('Loading candles for 6 symbols...');
  const candleStore: Record<string, Record<string, Candle[]>> = {};
  for (const sym of symbols) {
    candleStore[sym] = {};
    for (const tf of intervals) {
      candleStore[sym][tf] = await loadGzCandles(path.join(dataDir, `${sym}USDT_${tf}.csv.gz`));
    }
  }

  // 2. Generate and export trades_{SYM}_{TF}_Dstar.csv.gz for BTC, ETH, SOL, BNB, XRP, ADA (1h & 4h)
  const engine = new BacktestEngine();

  for (const sym of symbols) {
    for (const tf of intervals) {
      const activeCandles = candleStore[sym][tf];
      const c1h = candleStore[sym]['1h'];
      const c4h = candleStore[sym]['4h'];
      const barMs = tf === '1h' ? 3600000 : 14400000;

      const strat = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'confirm',
        fisherKind: 'fisher',
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        kijunSlopeFilter: true,
        structureFilter: true,
      });

      const res = engine.run({
        initialBalance: 10000,
        positionSizePercent: 5,
        maxOpenPositions: 1,
        tradeFeePercent: 0.1,
        tradeMode: 'long-short',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5 },
        strategy: strat,
        candles: activeCandles,
      });

      const header = 'entryTime,exitTime,side,entryPrice,exitPrice,pnlPercent,exitReason,barsHeld,mfePercent,maePercent\n';
      const rows = res.trades.map((t) => {
        const entryTime = t.entryTime ?? t.entrySignal?.timestamp ?? 0;
        const exitTime = t.exitTime ?? t.exitSignal?.timestamp ?? 0;
        const side = t.side;
        const entryPrice = t.entryPrice;
        const exitPrice = t.exitPrice;
        const pnlPercent = roundTo(t.pnlPercent ?? 0, 4);
        const exitReason = t.exitReason;
        const barsHeld = Math.max(1, Math.round((exitTime - entryTime) / barMs));
        const mfePercent = roundTo(t.maxFavorablePercent ?? 0, 4);
        const maePercent = roundTo(t.maxAdversePercent ?? 0, 4);
        return `${entryTime},${exitTime},${side},${entryPrice},${exitPrice},${pnlPercent},${exitReason},${barsHeld},${mfePercent},${maePercent}`;
      });

      const csvContent = header + rows.join('\n') + '\n';
      const compressed = await gzip(Buffer.from(csvContent, 'utf-8'));
      await fs.writeFile(path.join(outDir, `trades_${sym}_${tf}_Dstar.csv.gz`), compressed);
      console.log(`Exported trades_${sym}_${tf}_Dstar.csv.gz (${res.trades.length} trades)`);
    }
  }

  // 3. Load all trades across all 12 D* markets
  console.log('Loading all trades across 12 D* markets...');
  const allTrades: SimTradeRecord[] = [];

  for (const sym of symbols) {
    for (const tf of intervals) {
      const filePath = path.join(outDir, `trades_${sym}_${tf}_Dstar.csv.gz`);
      const comp = await fs.readFile(filePath);
      const decomp = await gunzip(comp);
      const text = decomp.toString('utf-8');
      const lines = text.trim().split('\n');

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        allTrades.push({
          market: `${sym}_${tf}`,
          symbol: sym,
          tf,
          entryTime: Number(parts[0]),
          exitTime: Number(parts[1]),
          entryPrice: Number(parts[3]),
          exitPrice: Number(parts[4]),
          pnlPercent: Number(parts[5]),
        });
      }
    }
  }

  allTrades.sort((a, b) => a.entryTime - b.entryTime || a.market.localeCompare(b.market));
  console.log(`Total candidate trades across 12 markets: ${allTrades.length}`);

  // Build price lookup map from 1h candles
  const priceMaps: Record<string, Map<number, number>> = {};
  for (const sym of symbols) {
    priceMaps[sym] = new Map();
    for (const c of candleStore[sym]['1h']) {
      priceMaps[sym].set(c.timestamp, c.close);
    }
  }

  const allTimestampsSet = new Set<number>();
  for (const sym of symbols) {
    for (const c of candleStore[sym]['1h']) {
      allTimestampsSet.add(c.timestamp);
    }
  }
  const timeline = Array.from(allTimestampsSet).sort((a, b) => a - b);

  const tradesByEntryTime = new Map<number, SimTradeRecord[]>();
  for (const t of allTrades) {
    if (!tradesByEntryTime.has(t.entryTime)) {
      tradesByEntryTime.set(t.entryTime, []);
    }
    tradesByEntryTime.get(t.entryTime)!.push(t);
  }

  // 4. Portfolio Simulator Engine
  function simulate(withBrake: boolean, positionSizePct: number, version: 'P1' | 'P2' | 'P3'): PortfolioSimResult {
    const initialBalance = 10000;
    const feeRate = 0.001; // 0.1%
    let cash = initialBalance;
    const openPositions: PortfolioPosition[] = [];
    const completedTrades: Array<{ pnlUSD: number }> = [];

    let rejectedSymbolOccupied = 0;
    let rejectedCapExposure = 0;
    let rejectedBrakeActive = 0;
    let executedCount = 0;

    let peakEquity = initialBalance;
    let brakeActive = false;
    let brakeStartTime = 0;

    let maxConcurrentNotionalUSD = 0;
    let maxConcurrentEntryNotionalPct = 0;
    let maxDailyMtmNotionalPct = 0;

    const dailyEquityMap = new Map<string, { equity: number; ddPct: number }>();

    const getMarkToMarketEquity = (ts: number): { equity: number; totalNotional: number } => {
      let openValue = 0;
      let totalNotional = 0;
      for (const pos of openPositions) {
        const curPrice = priceMaps[pos.symbol]?.get(ts) ?? pos.entryPrice;
        const grossVal = pos.quantity * curPrice;
        const exitFee = grossVal * feeRate;
        openValue += grossVal - exitFee;
        totalNotional += grossVal;
      }
      return {
        equity: cash + openValue,
        totalNotional,
      };
    };

    for (let i = 0; i < timeline.length; i++) {
      const ts = timeline[i];

      // A. Process Exits
      for (let p = openPositions.length - 1; p >= 0; p--) {
        const pos = openPositions[p];
        if (pos.exitTime <= ts) {
          const grossExit = pos.quantity * pos.exitPrice;
          const exitFee = grossExit * feeRate;
          const netCashReturned = grossExit - exitFee;
          cash += netCashReturned;

          const pnlUSD = netCashReturned - pos.entryCost;
          completedTrades.push({ pnlUSD });
          openPositions.splice(p, 1);
        }
      }

      // B. Mark-to-Market Equity
      const { equity: curEq, totalNotional: curNotional } = getMarkToMarketEquity(ts);

      if (withBrake) {
        if (!brakeActive) {
          if (curEq > peakEquity) {
            peakEquity = curEq;
          }
          const curDD = peakEquity > 0 ? ((peakEquity - curEq) / peakEquity) * 100 : 0;
          if (curDD >= 10) {
            brakeActive = true;
            brakeStartTime = ts;
          }
        } else {
          // Non-locking circuit brake:
          // Tripped at DD >= 10%; resumes after 30 calendar days or when DD <= 5%, whichever is first.
          // On resumption, rebase peak equity to current equity so prior drawdown doesn't block future brakes.
          const curDD = peakEquity > 0 ? ((peakEquity - curEq) / peakEquity) * 100 : 0;
          const daysElapsed = (ts - brakeStartTime) / (86400 * 1000);
          if (daysElapsed >= 30 || curDD <= 5) {
            brakeActive = false;
            brakeStartTime = 0;
            peakEquity = curEq; // Rebase
          }
        }
      } else {
        if (curEq > peakEquity) {
          peakEquity = curEq;
        }
      }

      if (curNotional > maxConcurrentNotionalUSD) {
        maxConcurrentNotionalUSD = curNotional;
      }

      // C. Process Entries
      const entries = tradesByEntryTime.get(ts);
      if (entries && entries.length > 0) {
        for (const tr of entries) {
          if (withBrake && brakeActive) {
            rejectedBrakeActive++;
            continue;
          }

          const symbolAlreadyOpen = openPositions.some((p) => p.symbol === tr.symbol);
          if (symbolAlreadyOpen) {
            rejectedSymbolOccupied++;
            continue;
          }

          const proposedNotional = (positionSizePct / 100) * curEq;

          // Rule: In entry moment: sum of open positions entry notional (at their entry price) + new notional <= 30% of current equity
          const openEntryNotionalSum = openPositions.reduce(
            (sum, p) => sum + p.quantity * p.entryPrice,
            0
          );
          const totalEntryNotional = openEntryNotionalSum + proposedNotional;

          if (totalEntryNotional > 0.30 * curEq + 1e-6) {
            rejectedCapExposure++;
            continue;
          }

          if (cash < proposedNotional) {
            rejectedCapExposure++;
            continue;
          }

          const entryNotionalPct = curEq > 0 ? (totalEntryNotional / curEq) * 100 : 0;
          if (entryNotionalPct > maxConcurrentEntryNotionalPct) {
            maxConcurrentEntryNotionalPct = entryNotionalPct;
          }

          const allocatedAmount = proposedNotional;
          const entryFee = allocatedAmount * feeRate;
          const netInvest = allocatedAmount - entryFee;
          const quantity = netInvest / tr.entryPrice;
          cash -= allocatedAmount;

          openPositions.push({
            symbol: tr.symbol,
            market: tr.market,
            tf: tr.tf,
            entryTime: tr.entryTime,
            exitTime: tr.exitTime,
            entryPrice: tr.entryPrice,
            exitPrice: tr.exitPrice,
            quantity,
            entryCost: allocatedAmount,
            entryFee,
          });

          executedCount++;
        }
      }

      // D. Record Daily Equity at day close (23:00 UTC)
      const dateObj = new Date(ts);
      const isDayEnd = dateObj.getUTCHours() === 23 || i === timeline.length - 1;
      if (isDayEnd) {
        const dateStr = dateObj.toISOString().split('T')[0];
        const dayEq = getMarkToMarketEquity(ts).equity;
        const dayDD = peakEquity > 0 ? ((peakEquity - dayEq) / peakEquity) * 100 : 0;
        dailyEquityMap.set(dateStr, { equity: roundTo(dayEq, 2), ddPct: roundTo(dayDD, 2) });

        const dayMtmPct = dayEq > 0 ? (curNotional / dayEq) * 100 : 0;
        if (dayMtmPct > maxDailyMtmNotionalPct) {
          maxDailyMtmNotionalPct = dayMtmPct;
        }
      }
    }

    const sortedDates = Array.from(dailyEquityMap.keys()).sort();
    let runDailyPeak = initialBalance;
    const dailyEquity = sortedDates.map((d) => {
      const eq = dailyEquityMap.get(d)!.equity;
      if (eq > runDailyPeak) runDailyPeak = eq;
      const dd = runDailyPeak > 0 ? ((runDailyPeak - eq) / runDailyPeak) * 100 : 0;
      return {
        date: d,
        equity: eq,
        drawdownPct: roundTo(dd, 2),
      };
    });

    let dailyPeak = initialBalance;
    let dailyMaxDD = 0;
    for (const d of dailyEquity) {
      if (d.equity > dailyPeak) dailyPeak = d.equity;
      const dd = dailyPeak > 0 ? ((dailyPeak - d.equity) / dailyPeak) * 100 : 0;
      if (dd > dailyMaxDD) dailyMaxDD = dd;
    }

    const finalEquity = dailyEquity.length > 0 ? dailyEquity[dailyEquity.length - 1].equity : initialBalance;
    const totalReturnPct = roundTo(((finalEquity - initialBalance) / initialBalance) * 100, 2);

    const yearlyReturns: Record<number, number> = {};
    for (const y of years) {
      const yearDays = dailyEquity.filter((d) => d.date.startsWith(String(y)));
      if (yearDays.length > 0) {
        const prevDays = dailyEquity.filter((d) => d.date < `${y}-01-01`);
        const startEq = prevDays.length > 0 ? prevDays[prevDays.length - 1].equity : yearDays[0].equity;
        const endEq = yearDays[yearDays.length - 1].equity;
        yearlyReturns[y] = roundTo(((endEq - startEq) / startEq) * 100, 2);
      } else {
        yearlyReturns[y] = 0;
      }
    }

    const sortedPnls = completedTrades.map((t) => t.pnlUSD).sort((a, b) => b - a);
    const top3Sum = sortedPnls.slice(0, 3).reduce((sum, v) => sum + v, 0);
    const totalRealizedPnl = completedTrades.reduce((sum, v) => sum + v.pnlUSD, 0);
    const pnlWithoutTop3 = totalRealizedPnl - top3Sum;
    const returnWithoutTop3Pct = roundTo((pnlWithoutTop3 / initialBalance) * 100, 2);

    const losingYears = years.filter((y) => (yearlyReturns[y] ?? 0) <= 0).length;
    const c1 = totalReturnPct > 0;
    const c2 = losingYears <= 2;
    const c3 = dailyMaxDD <= 12;
    const c4 = returnWithoutTop3Pct > 0;
    const c5 = maxConcurrentEntryNotionalPct <= 30.0 + 1e-4;

    const pass = c1 && c2 && c3 && c4 && c5;

    return {
      version,
      totalReturnPct,
      maxDrawdownPct: roundTo(dailyMaxDD, 2),
      yearlyReturns,
      executedTrades: executedCount,
      rejectedTrades: rejectedSymbolOccupied + rejectedCapExposure + rejectedBrakeActive,
      rejectedReasons: {
        symbolOccupied: rejectedSymbolOccupied,
        capExposure: rejectedCapExposure,
        brakeActive: rejectedBrakeActive,
      },
      maxConcurrentNotionalUSD: roundTo(maxConcurrentNotionalUSD, 2),
      maxConcurrentEntryNotionalPct: roundTo(maxConcurrentEntryNotionalPct, 2),
      maxDailyMtmNotionalPct: roundTo(maxDailyMtmNotionalPct, 2),
      returnWithoutTop3Pct,
      pass,
      dailyEquity,
    };
  }

  const resP1 = simulate(false, 5, 'P1');
  const resP2 = simulate(true, 5, 'P2');
  const resP3 = simulate(true, 2.5, 'P3');

  console.log('\n--- Portfolio Simulation Results (D*) ---');
  console.log(`P1 (No Brake, 5%): Return=+${resP1.totalReturnPct}%, MaxDD=${resP1.maxDrawdownPct}%, Executed=${resP1.executedTrades}, Rejected=${resP1.rejectedTrades}, NoTop3=${resP1.returnWithoutTop3Pct}%, EntryCap=${resP1.maxConcurrentEntryNotionalPct}%, Pass=${resP1.pass}`);
  console.log(`P2 (With Brake, 5%): Return=+${resP2.totalReturnPct}%, MaxDD=${resP2.maxDrawdownPct}%, Executed=${resP2.executedTrades}, Rejected=${resP2.rejectedTrades}, NoTop3=${resP2.returnWithoutTop3Pct}%, EntryCap=${resP2.maxConcurrentEntryNotionalPct}%, Pass=${resP2.pass}`);
  console.log(`P3 (With Brake, 2.5%): Return=+${resP3.totalReturnPct}%, MaxDD=${resP3.maxDrawdownPct}%, Executed=${resP3.executedTrades}, Rejected=${resP3.rejectedTrades}, NoTop3=${resP3.returnWithoutTop3Pct}%, EntryCap=${resP3.maxConcurrentEntryNotionalPct}%, Pass=${resP3.pass}`);

  // 5. Write docs/review/validation/portfolio_equity.csv.gz
  const allDates = Array.from(
    new Set([
      ...resP1.dailyEquity.map((d) => d.date),
      ...resP2.dailyEquity.map((d) => d.date),
      ...resP3.dailyEquity.map((d) => d.date),
    ])
  ).sort();

  const p1Map = new Map(resP1.dailyEquity.map((d) => [d.date, d]));
  const p2Map = new Map(resP2.dailyEquity.map((d) => [d.date, d]));
  const p3Map = new Map(resP3.dailyEquity.map((d) => [d.date, d]));

  const eqHeader = 'date,equity_p1,drawdown_p1,equity_p2,drawdown_p2,equity_p3,drawdown_p3\n';
  const eqRows = allDates.map((d) => {
    const d1 = p1Map.get(d) ?? { equity: 10000, drawdownPct: 0 };
    const d2 = p2Map.get(d) ?? { equity: 10000, drawdownPct: 0 };
    const d3 = p3Map.get(d) ?? { equity: 10000, drawdownPct: 0 };
    return `${d},${d1.equity.toFixed(2)},${d1.drawdownPct.toFixed(2)},${d2.equity.toFixed(2)},${d2.drawdownPct.toFixed(2)},${d3.equity.toFixed(2)},${d3.drawdownPct.toFixed(2)}`;
  });

  const eqCsvCompressed = await gzip(Buffer.from(eqHeader + eqRows.join('\n') + '\n', 'utf-8'));
  await fs.writeFile(path.join(outDir, 'portfolio_equity.csv.gz'), eqCsvCompressed);
  console.log('Saved docs/review/validation/portfolio_equity.csv.gz');

  // 6. Write docs/review/PORTFOLIO.md (<= 100 lines)
  const mdLines: string[] = [
    '# Multi-Market Portfolio Simulation Report (D*)',
    '> Capital: $10,000 | 12 Markets (BTC, ETH, SOL, BNB, XRP, ADA on 1h & 4h) | Trailing 5/3/1.5 (initial/step/raise) | Notional Cap 30%',
    '',
    '### 1. Performance Overview & Acceptance Criteria',
    '| Metric | P1 (No Brake, 5%) | P2 (Circuit Brake, 5%) | P3 (Circuit Brake, 2.5%) | Criterion |',
    '|---|:---:|:---:|:---:|:---:|',
    `| **Total Return** | +${resP1.totalReturnPct.toFixed(1)}% | +${resP2.totalReturnPct.toFixed(1)}% | +${resP3.totalReturnPct.toFixed(1)}% | > 0% |`,
    `| **Max Drawdown (Daily Close)** | ${resP1.maxDrawdownPct.toFixed(1)}% | ${resP2.maxDrawdownPct.toFixed(1)}% | ${resP3.maxDrawdownPct.toFixed(1)}% | ≤ 12.0% |`,
    `| **Return Without Top 3 Trades** | +${resP1.returnWithoutTop3Pct.toFixed(1)}% | +${resP2.returnWithoutTop3Pct.toFixed(1)}% | +${resP3.returnWithoutTop3Pct.toFixed(1)}% | > 0% |`,
    `| **Losing Years (≤ 0%)** | ${years.filter((y) => (resP1.yearlyReturns[y] ?? 0) <= 0).length} / 6 | ${years.filter((y) => (resP2.yearlyReturns[y] ?? 0) <= 0).length} / 6 | ${years.filter((y) => (resP3.yearlyReturns[y] ?? 0) <= 0).length} / 6 | ≤ 2 of 6 |`,
    `| **Max Entry Notional / Equity** | ${resP1.maxConcurrentEntryNotionalPct.toFixed(1)}% | ${resP2.maxConcurrentEntryNotionalPct.toFixed(1)}% | ${resP3.maxConcurrentEntryNotionalPct.toFixed(1)}% | ≤ 30.0% |`,
    `| **Max Daily MTM Notional / Equity** | ${resP1.maxDailyMtmNotionalPct.toFixed(1)}% | ${resP2.maxDailyMtmNotionalPct.toFixed(1)}% | ${resP3.maxDailyMtmNotionalPct.toFixed(1)}% | (Info) |`,
    `| **Executed Trades** | ${resP1.executedTrades} | ${resP2.executedTrades} | ${resP3.executedTrades} | - |`,
    `| **Rejected Trades (Cap / Symbol / Brake)** | ${resP1.rejectedTrades} (${resP1.rejectedReasons.capExposure} / ${resP1.rejectedReasons.symbolOccupied} / ${resP1.rejectedReasons.brakeActive}) | ${resP2.rejectedTrades} (${resP2.rejectedReasons.capExposure} / ${resP2.rejectedReasons.symbolOccupied} / ${resP2.rejectedReasons.brakeActive}) | ${resP3.rejectedTrades} (${resP3.rejectedReasons.capExposure} / ${resP3.rejectedReasons.symbolOccupied} / ${resP3.rejectedReasons.brakeActive}) | - |`,
    `| **Verdict** | ${resP1.pass ? '**PASS**' : '**FAIL**'} | ${resP2.pass ? '**PASS**' : '**FAIL**'} | ${resP3.pass ? '**PASS**' : '**FAIL**'} | All 5 met |`,
    '',
    '### 2. Yearly Returns Breakdown (2021–2026)',
    '| Year | P1 (No Brake, 5%) | P2 (Circuit Brake, 5%) | P3 (Circuit Brake, 2.5%) |',
    '|:---:|:---:|:---:|:---:|',
    `| 2021 | ${resP1.yearlyReturns[2021] > 0 ? '+' : ''}${resP1.yearlyReturns[2021].toFixed(1)}% | ${resP2.yearlyReturns[2021] > 0 ? '+' : ''}${resP2.yearlyReturns[2021].toFixed(1)}% | ${resP3.yearlyReturns[2021] > 0 ? '+' : ''}${resP3.yearlyReturns[2021].toFixed(1)}% |`,
    `| 2022 | ${resP1.yearlyReturns[2022] > 0 ? '+' : ''}${resP1.yearlyReturns[2022].toFixed(1)}% | ${resP2.yearlyReturns[2022] > 0 ? '+' : ''}${resP2.yearlyReturns[2022].toFixed(1)}% | ${resP3.yearlyReturns[2022] > 0 ? '+' : ''}${resP3.yearlyReturns[2022].toFixed(1)}% |`,
    `| 2023 | ${resP1.yearlyReturns[2023] > 0 ? '+' : ''}${resP1.yearlyReturns[2023].toFixed(1)}% | ${resP2.yearlyReturns[2023] > 0 ? '+' : ''}${resP2.yearlyReturns[2023].toFixed(1)}% | ${resP3.yearlyReturns[2023] > 0 ? '+' : ''}${resP3.yearlyReturns[2023].toFixed(1)}% |`,
    `| 2024 | ${resP1.yearlyReturns[2024] > 0 ? '+' : ''}${resP1.yearlyReturns[2024].toFixed(1)}% | ${resP2.yearlyReturns[2024] > 0 ? '+' : ''}${resP2.yearlyReturns[2024].toFixed(1)}% | ${resP3.yearlyReturns[2024] > 0 ? '+' : ''}${resP3.yearlyReturns[2024].toFixed(1)}% |`,
    `| 2025 | ${resP1.yearlyReturns[2025] > 0 ? '+' : ''}${resP1.yearlyReturns[2025].toFixed(1)}% | ${resP2.yearlyReturns[2025] > 0 ? '+' : ''}${resP2.yearlyReturns[2025].toFixed(1)}% | ${resP3.yearlyReturns[2025] > 0 ? '+' : ''}${resP3.yearlyReturns[2025].toFixed(1)}% |`,
    `| 2026 | ${resP1.yearlyReturns[2026] > 0 ? '+' : ''}${resP1.yearlyReturns[2026].toFixed(1)}% | ${resP2.yearlyReturns[2026] > 0 ? '+' : ''}${resP2.yearlyReturns[2026].toFixed(1)}% | ${resP3.yearlyReturns[2026] > 0 ? '+' : ''}${resP3.yearlyReturns[2026].toFixed(1)}% |`,
    '',
    '### 3. Summary & Observations',
    '- **Cross-Asset Diversification**: Spreading capital across 6 major crypto assets dampens individual asset drawdowns while participating in major structural trends.',
    '- **Notional Exposure Cap**: Aggregate entry notional across open positions is strictly bounded at ≤ 30% of current equity at every entry moment.',
    '- **Circuit Brake Mechanics**: Trips at portfolio drawdown ≥ 10% from peak. Automatically resumes when 30 calendar days elapse or when drawdown recovers to ≤ 5%, rebasing peak equity to current equity upon resumption.',
  ];

  const mdContent = mdLines.join('\n') + '\n';
  const mdLineCount = mdContent.split('\n').length;
  console.log(`PORTFOLIO.md line count: ${mdLineCount} (budget <= 100)`);
  if (mdLineCount > 100) {
    console.error(`ERROR: PORTFOLIO.md exceeds 100 lines: ${mdLineCount}`);
  } else {
    await fs.writeFile(path.resolve(rootDir, 'docs', 'review', 'PORTFOLIO.md'), mdContent, 'utf-8');
  }

  console.log('=== Step 7 Complete ===');
}

if (require.main === module || process.argv[1]?.includes('portfolio')) {
  runPortfolioSimulation().catch((err) => {
    console.error('Portfolio simulation failed:', err);
    process.exit(1);
  });
}
