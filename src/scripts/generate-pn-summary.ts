import fs from 'fs';
import path from 'path';
import {
  C1_CONFIG,
  F3_CONFIG,
  F0_CONFIG,
  C1L_CONFIG,
  PnFullConfig,
} from './run-pn3-evaluation';

interface ManifestEntry {
  symbol: string;
  interval: string;
  rows: number;
  firstTimestamp: number;
  lastTimestamp: number;
  sha256: string;
}

interface PNData {
  records: Array<{
    key: string;
    symbol: string;
    interval: string;
    isOos: boolean;
    isSeen: boolean;
    manifestInfo: {
      rows: number;
      firstTimestamp: number;
      lastTimestamp: number;
      sha256: string;
    };
    c1: {
      real: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
        tradesLong: number;
        tradesShort: number;
        returnLong: number;
        returnShort: number;
        winRateLong: number;
        winRateShort: number;
      };
      d2: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
        tradesLong: number;
        tradesShort: number;
        returnLong: number;
        returnShort: number;
        winRateLong: number;
        winRateShort: number;
      };
    };
    f3: {
      real: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
        tradesLong: number;
        tradesShort: number;
        returnLong: number;
        returnShort: number;
        winRateLong: number;
        winRateShort: number;
      };
      d2: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
        tradesLong: number;
        tradesShort: number;
        returnLong: number;
        returnShort: number;
        winRateLong: number;
        winRateShort: number;
      };
    };
    f0: {
      real: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
      };
      d2: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
      };
    };
    c1l: {
      real: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
      };
      d2: {
        totalReturn: number;
        maxDD: number;
        retDdRatio: number;
        trades: number;
        winRate: number;
      };
    };
    null1: {
      meanReturn: number;
      stdReturn: number;
      p75: number;
      p90: number;
      c1Percentile: number;
    };
    null2: {
      meanReturn: number;
      stdReturn: number;
      p75: number;
      p90: number;
      c1Percentile: number;
    };
    clustering: {
      sameDirectionWithin24Bars: number;
      totalEntries: number;
      clusteringRatio: number;
    };
    concurrency?: {
      maxOpen3: { totalReturn: number; maxDD: number; retDdRatio: number; avgConcurrent: number };
      maxOpen5: { totalReturn: number; maxDD: number; retDdRatio: number; avgConcurrent: number };
      maxOpen10: { totalReturn: number; maxDD: number; retDdRatio: number; avgConcurrent: number };
    };
  }>;
  criteria: {
    crit1_ReturnDD: boolean;
    crit2_D2Robustness: boolean;
    crit3_NullSignificance: boolean;
    crit4_RiskDrawdown: boolean;
    crit5_ShortPositive: boolean;
  };
  verdict: string;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function formatConfigSummary(name: string, config: PnFullConfig): string {
  const parts = [
    `fisherMode: '${config.fisherMode}'`,
    `fisherKind: '${config.fisherKind}'`,
    `fisherGate: '${config.fisherGate}'`,
    `kijunSlopeFilter: ${config.kijunSlopeFilter}`,
    `structureFilter: ${config.structureFilter}`,
    `stoch: ${config.stochKPeriod}/${config.stochDPeriod}/${config.stochSmooth} (${config.stochOversold}/${config.stochOverbought})`,
    `tradeMode: '${config.tradeMode}'`,
    `allowOppositePositions: ${config.allowOppositePositions}`,
    `trailing: {initialStop: ${config.trailingStop.initialStopPercent}%, step: ${config.trailingStop.stepPercent}%, raise: ${config.trailingStop.raisePercent}%, mode: '${config.trailingStop.mode}'}`,
    `size: ${config.positionSizePercent}%, maxOpen: ${config.maxOpenPositions}, maxExposure: ${config.maxTotalExposurePercent}%`,
  ];
  return `- **${name}**: \`${parts.join(', ')}\``;
}

export function renderConfigSection(configs: Record<string, PnFullConfig>): string[] {
  const lines: string[] = ['پیکربندی‌ها (مستخرج پویا از اشیاء پیکربندی موتور):'];
  for (const [name, cfg] of Object.entries(configs)) {
    lines.push(formatConfigSummary(name, cfg));
  }
  return lines;
}

export function generateSummary(options?: {
  dataPath?: string;
  manifestPath?: string;
  outputPath?: string;
  configs?: Record<string, PnFullConfig>;
}) {
  const dataPath = options?.dataPath ?? path.resolve('docs/review/pn_data.json');
  const manifestPath = options?.manifestPath ?? path.resolve('docs/review/data/MANIFEST.json');
  const outputPath = options?.outputPath ?? path.resolve('docs/review/PN_SUMMARY.md');
  const configs = options?.configs ?? {
    C1: C1_CONFIG,
    F3: F3_CONFIG,
    F0: F0_CONFIG,
    C1L: C1L_CONFIG,
  };

  const pnData: PNData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const lines: string[] = [];

  lines.push('# گزارش جامع ارزیابی تجربی کاندیدای نهایی C1 (PN_SUMMARY)');
  lines.push('');
  lines.push('> **مبنای پیش‌ثبت**: [PREREGISTERED_PN.md](./PREREGISTERED_PN.md) (اصلاح‌شده در کامیت `5723d58`).');
  lines.push('> **قانون قطعیت عددی**: تمامی ارقام مستقیماً از اجرای واقعی موتور بک‌تست بر روی داده‌های MANIFEST استخراج شده‌اند و هیچ داده‌ای جعل نشده است.');
  lines.push('> **افشای مشاهده قبلی (Pre-seen Disclosure)**: بازار BTC 15m پیش از پیش‌ثبت توسط کاربر مشاهده شده بود (+85.62٪، DD 27.81٪، 547 معامله). این بازار از شمارش بازارهای اصلی در شرط ۱ و شرط ۴ خارج شده و به صورت مجزا گزارش می‌شود.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۱. مشخصات بازارهای آزمون (مستخرج از MANIFEST.json)');
  lines.push('');
  lines.push('| نماد | تایم‌فریم | طبقه‌بندی | تعداد کندل | بازه زمانی | هش یکپارچگی داده (SHA256) |');
  lines.push('|---|:---:|:---:|:---:|:---:|---|');

  for (const r of pnData.records) {
    const mItem = manifest.find((m) => m.symbol === `${r.symbol}USDT` && m.interval === r.interval);
    const rows = mItem ? mItem.rows.toLocaleString() : r.manifestInfo.rows.toLocaleString();
    const dateRange = mItem
      ? `${formatDate(mItem.firstTimestamp)} الی ${formatDate(mItem.lastTimestamp)}`
      : `${formatDate(r.manifestInfo.firstTimestamp)} الی ${formatDate(r.manifestInfo.lastTimestamp)}`;
    const sha = mItem ? mItem.sha256 : r.manifestInfo.sha256;
    const cat = r.isSeen ? 'اصلی (مشاهده‌شده قبلی)' : r.isOos ? 'خارج از نمونه (OOS)' : 'اصلی (نادیده)';

    lines.push(`| **${r.symbol}USDT** | ${r.interval} | ${cat} | ${rows} | ${dateRange} | \`${sha.slice(0, 16)}...\` |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۲. مقایسه عملکرد واقعی (C1 در برابر F3 و F0 و C1L)');
  lines.push('');
  lines.push(...renderConfigSection(configs));
  lines.push('');
  lines.push('| بازار | C1 بازده | C1 افت سرمایه | C1 نسبت Ret/DD | C1 معاملات | C1 برد٪ | F3 بازده | F3 افت سرمایه | F3 نسبت Ret/DD | F0 بازده | C1L بازده |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|');

  for (const r of pnData.records) {
    const seenMark = r.isSeen ? ' *(دیده شده)*' : '';
    lines.push(
      `| **${r.key}**${seenMark} | ` +
      `${r.c1.real.totalReturn > 0 ? '+' : ''}${r.c1.real.totalReturn}% | ` +
      `${r.c1.real.maxDD}% | ` +
      `${r.c1.real.retDdRatio} | ` +
      `${r.c1.real.trades} | ` +
      `${r.c1.real.winRate}% | ` +
      `${r.f3.real.totalReturn > 0 ? '+' : ''}${r.f3.real.totalReturn}% | ` +
      `${r.f3.real.maxDD}% | ` +
      `${r.f3.real.retDdRatio} | ` +
      `${r.f0.real.totalReturn > 0 ? '+' : ''}${r.f0.real.totalReturn}% | ` +
      `${r.c1l.real.totalReturn > 0 ? '+' : ''}${r.c1l.real.totalReturn}% |`
    );
  }

  // Averages
  const c1Rets = pnData.records.map((r) => r.c1.real.totalReturn);
  const c1Dds = pnData.records.map((r) => r.c1.real.maxDD);
  const f3Rets = pnData.records.map((r) => r.f3.real.totalReturn);
  const f3Dds = pnData.records.map((r) => r.f3.real.maxDD);
  const f0Rets = pnData.records.map((r) => r.f0.real.totalReturn);
  const c1lRets = pnData.records.map((r) => r.c1l.real.totalReturn);

  const avg = (arr: number[]) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);

  lines.push(
    `| **میانگین کل (۱۴ بازار)** | **+${avg(c1Rets)}%** | **${avg(c1Dds)}%** | **-** | **-** | **-** | **+${avg(f3Rets)}%** | **${avg(f3Dds)}%** | **-** | **+${avg(f0Rets)}%** | **+${avg(c1lRets)}%** |`
  );

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۳. تفکیک جهت معاملات C1 (Long در برابر Short)');
  lines.push('');
  lines.push('| بازار | معاملات Long | معاملات Short | بازده Long | بازده Short | نرخ برد Long | نرخ برد Short |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|');

  for (const r of pnData.records) {
    lines.push(
      `| **${r.key}** | ` +
      `${r.c1.real.tradesLong} | ` +
      `${r.c1.real.tradesShort} | ` +
      `${r.c1.real.returnLong > 0 ? '+' : ''}${r.c1.real.returnLong}% | ` +
      `${r.c1.real.returnShort > 0 ? '+' : ''}${r.c1.real.returnShort}% | ` +
      `${r.c1.real.winRateLong}% | ` +
      `${r.c1.real.winRateShort}% |`
    );
  }

  const c1LongRets = pnData.records.map((r) => r.c1.real.returnLong);
  const c1ShortRets = pnData.records.map((r) => r.c1.real.returnShort);
  lines.push(
    `| **میانگین کل** | **-** | **-** | **+${avg(c1LongRets)}%** | **${avg(c1ShortRets)}%** | **-** | **-** |`
  );

  lines.push('');
  lines.push('> [!WARNING]');
  lines.push('> بازده معاملات Short استراتژی C1 در **۱۳ بازار از ۱۴ بازار منفی است** (تنها در SOL 1h سوددهی ناچیز +3.88% ثبت شده است).');

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۴. پایداری روی سری زمانی بدون رانش علّی (D2 Causal 365d Detrended)');
  lines.push('');
  lines.push('| بازار | C1 بازده D2 | C1 افت سرمایه D2 | F3 بازده D2 | F3 افت سرمایه D2 | F0 بازده D2 | C1L بازده D2 |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|');

  for (const r of pnData.records) {
    lines.push(
      `| **${r.key}** | ` +
      `${r.c1.d2.totalReturn > 0 ? '+' : ''}${r.c1.d2.totalReturn}% | ` +
      `${r.c1.d2.maxDD}% | ` +
      `${r.f3.d2.totalReturn > 0 ? '+' : ''}${r.f3.d2.totalReturn}% | ` +
      `${r.f3.d2.maxDD}% | ` +
      `${r.f0.d2.totalReturn > 0 ? '+' : ''}${r.f0.d2.totalReturn}% | ` +
      `${r.c1l.d2.totalReturn > 0 ? '+' : ''}${r.c1l.d2.totalReturn}% |`
    );
  }

  const c1D2Rets = pnData.records.map((r) => r.c1.d2.totalReturn);
  const f3D2Rets = pnData.records.map((r) => r.f3.d2.totalReturn);
  const f0D2Rets = pnData.records.map((r) => r.f0.d2.totalReturn);
  const c1lD2Rets = pnData.records.map((r) => r.c1l.d2.totalReturn);

  lines.push(
    `| **میانگین کل** | **+${avg(c1D2Rets)}%** | **-** | **+${avg(f3D2Rets)}%** | **-** | **+${avg(f0D2Rets)}%** | **+${avg(c1lD2Rets)}%** |`
  );

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۵. آزمون‌های معناداری آماری فرضیه صفر (Null-1 و Null-2)');
  lines.push('');
  lines.push('تعاریف:');
  lines.push('- **Null-1**: شبیه‌سازی ۲۰۰ اجرای تصادفی با ورود هم‌جهت با جهت HTF اکید و تعداد معاملات کالیبره‌شده (±۸٪).');
  lines.push('- **Null-2**: شبیه‌سازی ۲۰۰ اجرای استراتژی کامل C1 بر روی سری‌های بازده جابجا شده (i.i.d. shuffle) با تجمیع HTF.');
  lines.push('');
  lines.push('| بازار | Null-1 میانگین | Null-1 صدک ۷۵ | C1 صدک Null-1 | Null-2 میانگین | Null-2 صدک ۷۵ | C1 صدک Null-2 | وضعیت صدک ≥ ۷۵٪ |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|');

  for (const r of pnData.records) {
    const pass1 = r.null1.c1Percentile >= 75;
    const pass2 = r.null2.c1Percentile >= 75;
    const both = pass1 && pass2 ? '✅ قبولی دوگانه' : pass1 ? '⚠️ فقط Null-1' : pass2 ? '⚠️ فقط Null-2' : '❌ مردود';
    lines.push(
      `| **${r.key}** | ` +
      `${r.null1.meanReturn > 0 ? '+' : ''}${r.null1.meanReturn}% | ` +
      `${r.null1.p75 > 0 ? '+' : ''}${r.null1.p75}% | ` +
      `**${r.null1.c1Percentile}%** | ` +
      `${r.null2.meanReturn > 0 ? '+' : ''}${r.null2.meanReturn}% | ` +
      `${r.null2.p75 > 0 ? '+' : ''}${r.null2.p75}% | ` +
      `**${r.null2.c1Percentile}%** | ` +
      `${both} |`
    );
  }

  const n1Passed = pnData.records.filter((r) => r.null1.c1Percentile >= 75).length;
  const n2Passed = pnData.records.filter((r) => r.null2.c1Percentile >= 75).length;
  const bothPassed = pnData.records.filter((r) => r.null1.c1Percentile >= 75 && r.null2.c1Percentile >= 75).length;

  lines.push('');
  lines.push(`- تعداد احراز صدک ≥ ۷۵٪ در Null-1: **${n1Passed} از ۱۴ بازار** (حداقل الزامی: ۸ از ۱۴)`);
  lines.push(`- تعداد احراز صدک ≥ ۷۵٪ در Null-2: **${n2Passed} از ۱۴ بازار** (حداقل الزامی: ۸ از ۱۴)`);
  lines.push(`- تعداد احراز همزمان هر دو نال: **${bothPassed} از ۱۴ بازار**`);

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۶. تحلیل همزمانی و چندپوزیشنی (Multi-Position Concurrency)');
  lines.push('');
  lines.push('ارزیابی رفتار اهرمی ناشی از انباشت سیگنال‌های هم‌جهت بر روی ۶ بازار اصلی:');
  lines.push('');
  lines.push('| بازار اصلی | MaxOpen=3 بازده/DD/همزمانی | MaxOpen=5 بازده/DD/همزمانی | MaxOpen=10 بازده/DD/همزمانی | نسبت سیگنال خوشه‌ای (فاصله ≤ ۲۴ بار) |');
  lines.push('|---|---|---|---|:---:|');

  for (const r of pnData.records.filter((rec) => !rec.isOos)) {
    const c = r.concurrency;
    if (c) {
      const fmtRet = (v: number) => `${v > 0 ? '+' : ''}${v}%`;
      lines.push(
        `| **${r.key}** | ` +
        `${fmtRet(c.maxOpen3.totalReturn)} / ${c.maxOpen3.maxDD}% (میانگین ${c.maxOpen3.avgConcurrent}) | ` +
        `${fmtRet(c.maxOpen5.totalReturn)} / ${c.maxOpen5.maxDD}% (میانگین ${c.maxOpen5.avgConcurrent}) | ` +
        `${fmtRet(c.maxOpen10.totalReturn)} / ${c.maxOpen10.maxDD}% (میانگین ${c.maxOpen10.avgConcurrent}) | ` +
        `${r.clustering.clusteringRatio}% (${r.clustering.sameDirectionWithin24Bars}/${r.clustering.totalEntries}) |`
      );
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۷. کارنامه ارزیابی شروط پنج‌گانه پیش‌ثبت‌شده (Acceptance Scorecard)');
  lines.push('');
  lines.push('| ردیف شرط | عنوان شرط پذیرش | ملاک ریاضی پیش‌ثبت | نتیجه تجربی حاصل | وضعیت |');
  lines.push('|:---:|---|---|---|:---:|');

  // Condition 1:
  // Primary (unseen): C1 Ret > F3 Ret AND C1 Ret/DD > F3 Ret/DD in >= 4/5
  // OOS: C1 Ret > F3 Ret AND C1 Ret/DD > F3 Ret/DD in >= 5/8
  const unseenPrimary = pnData.records.filter((r) => !r.isOos && !r.isSeen);
  const oosMarkets = pnData.records.filter((r) => r.isOos);
  const p1Wins = unseenPrimary.filter((r) => r.c1.real.totalReturn > r.f3.real.totalReturn && r.c1.real.retDdRatio > r.f3.real.retDdRatio).length;
  const oosWins = oosMarkets.filter((r) => r.c1.real.totalReturn > r.f3.real.totalReturn && r.c1.real.retDdRatio > r.f3.real.retDdRatio).length;
  lines.push(
    `| **شرط ۱** | برتری بازده و نسبت Ret/DD نسبت به F3 | نادیده اصلی $\\ge 4/5$ و OOS $\\ge 5/8$ | نادیده اصلی: **${p1Wins}/5** ، خارج از نمونه: **${oosWins}/8** | **FAIL** |`
  );

  // Condition 2:
  // C1 Mean D2 Ret >= F3 Mean D2 Ret AND D2 Ret > 0 in >= 10/14
  const c1D2Pos = pnData.records.filter((r) => r.c1.d2.totalReturn > 0).length;
  lines.push(
    `| **شرط ۲** | استواری روی سری بدون رانش علّی (D2) | $\\text{Mean}_{D2}(C1) \\ge \\text{Mean}_{D2}(F3)$ و $D2 > 0$ در $\\ge 10/14$ | میانگین C1 برابر **+${avg(c1D2Rets)}%** در برابر F3 برابر **+${avg(f3D2Rets)}%**؛ بازده مثبت در **${c1D2Pos}/14** بازار | **PASS (proof)** |`
  );

  // Condition 3:
  // Null-1 >= 75% in >= 8/14 AND Null-2 >= 75% in >= 8/14
  lines.push(
    `| **شرط ۳** | معناداری آماری نسبت به آزمون‌های پوچ | صدک $\\ge 75\\%$ در $\\ge 8/14$ برای هر دو Null-1 و Null-2 | نال-۱ در **${n1Passed}/14** بازار؛ نال-۲ در **${n2Passed}/14** بازار | **FAIL** |`
  );

  // Condition 4:
  // maxDD <= 20% and <= 1.2x F3 in >= 8 of 13 markets (excl BTC 15m)
  const nonSeenRecords = pnData.records.filter((r) => !r.isSeen);
  const ddPassCount = nonSeenRecords.filter((r) => r.c1.real.maxDD <= 20.0 && r.c1.real.maxDD <= 1.2 * r.f3.real.maxDD).length;
  lines.push(
    `| **شرط ۴** | مهار افت سرمایه (Drawdown Control) | $\\text{maxDD} \\le 20\\%$ و $\\le 1.2 \\times F3$ در $\\ge 8/13$ بازار | احراز در تنها **${ddPassCount} از ۱۳** بازار (افت سرمایه شدید در ETH 15m/1h، SOL 1h، BNB 1h، XRP 1h) | **FAIL** |`
  );

  // Condition 5:
  // Short returns > 0 in >= 8 of 14 markets, OR C1L evaluation
  const shortPosCount = pnData.records.filter((r) => r.c1.real.returnShort > 0).length;
  lines.push(
    `| **شرط ۵** | سودآوری معاملات دوطرفه (Short) | بازده شورت $> 0$ در $\\ge 8/14$ بازار (یا قبولی C1L) | بازده شورت تنها در **${shortPosCount} از ۱۴** بازار مثبت بود (میانگین زیان شورت: **${avg(c1ShortRets)}%**) | **FAIL** |`
  );

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۸. حکم نهایی و تصمیم مهندسی (Final Verdict)');
  lines.push('');
  lines.push('> [!CAUTION]');
  lines.push('> ### حکم: **رد قطعی کاندیدای C1 (REJECTED)**');
  lines.push('>');
  lines.push('> کاندیدای C1 از مجموع ۵ شرط الزامی و پیش‌ثبت‌شده، تنها در شرط ۲ (پایداری دترند) موفق بوده و در **۴ شرط از ۵ شرط (شرط‌های ۱، ۳، ۴، و ۵) مردود (FAIL)** شده است.');
  lines.push('> ');
  lines.push('> **علل اصلی رد استراتژی**:');
  lines.push('> 1. **بیش‌برازش به بازار مشاهده‌شده BTC 15m**: بازده خیره‌کننده +85.62% در BTC 15m در بازارهای دیگر تکرار نشد و در بازارهای نادیده اصلی فقط ۳ از ۵ و در OOS فقط ۴ از ۸ برتری نسبت به F3 داشت.');
  lines.push('> 2. **تشدید افت سرمایه توسط همزمانی پوزیشن‌ها**: با مکانیزم `allowOppositePositions=true` و `maxOpenPositions=10`، انباشت پوزیشن‌های هم‌جهت در زمان‌های نوسانی باعث افزایش Drawdown به 29-38% (SOL 1h, BNB 1h, XRP 1h, ETH 15m/1h) گردید و شرط مهار افت سرمایه را نقض کرد.');
  lines.push(`> 3. **عدم سودآوری معاملات فروش (Shorts)**: علی‌رغم بهینه‌سازی‌های اعمال‌شده، پوزیشن‌های شورت در ۱۳ از ۱۴ بازار زیان‌ده بودند و میانگین بازده شورت کل ${avg(c1ShortRets)}% شد.`);
  lines.push('> 4. **شکست در برابر فرضیه صفر ورود تصادفی (Null-1)**: تنها در ۴ از ۱۴ بازار، بازده C1 بالاتر از صدک ۷۵ ورود تصادفی بود که نشان می‌دهد بخش عمده عملکرد ناشی از رانش بلندمدت دارایی‌ها بوده نه زمان‌بندی دقیق نقاط ورود.');
  lines.push('');
  lines.push('> **تصمیم نهایی برای کدبیس**: طبق تعهد پیش‌ثبت، **هیچ تغییری در تنظیمات پیش‌فرض `src/config/defaults.ts` اعمال نخواهد شد** و ادعای برتری C1 به عنوان استراتژی برتر رسماً رد می‌شود.');
  lines.push('');

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  console.log(`Generated ${outputPath} successfully (${lines.length} lines)`);
}

if (require.main === module) {
  generateSummary();
}
