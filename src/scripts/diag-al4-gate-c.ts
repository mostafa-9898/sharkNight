import * as fs from 'fs';
import * as path from 'path';
import { roundTo } from '../utils/math';

interface MarketCandidateRecord {
  market: string;
  isOos: boolean;
  baseline: {
    real: { maxDD: number; totalReturn: number };
    detrended: { maxDD: number; totalReturn: number };
  };
  candidates: Record<
    string,
    {
      real: { maxDD: number; totalReturn: number };
      detrended: { maxDD: number; totalReturn: number };
    }
  >;
}

interface Al4Data {
  metadata: {
    baselineRealMaxDDAvg: number;
    baselineRealReturnAvg: number;
    marketsCount: number;
  };
  summaries: Array<{
    name: string;
    label: string;
    criteriaA: boolean;
    criteriaB: boolean;
    criteriaC: boolean;
    criteriaD: boolean;
    overallPassed: boolean;
    realMaxDDAvg: number;
  }>;
  markets: MarketCandidateRecord[];
}

export type GateCViolationType = 'none' | 'ratio_1_2' | 'cap_20' | 'both';

export interface MarketGateCDiag {
  market: string;
  isOos: boolean;
  baselineMaxDD: number;
  candidateMaxDD: number;
  ratio: number;
  violatedRatio: boolean;
  violatedCap20: boolean;
  violationType: GateCViolationType;
}

export interface CandidateGateCDiag {
  candidateKey: string;
  label: string;
  avgRealMaxDD: number;
  baselineAvgRealMaxDD: number;
  passOnAverage: boolean;
  passOnIndividualMarkets: boolean;
  officialVerdict: boolean;
  violatingMarketCount: number;
  totalMarkets: number;
  worstMarketByMaxDD: {
    market: string;
    candidateMaxDD: number;
    baselineMaxDD: number;
  };
  worstMarketByRatio: {
    market: string;
    ratio: number;
    candidateMaxDD: number;
    baselineMaxDD: number;
  };
  markets: MarketGateCDiag[];
}

export function runGateCDiagnostic(): void {
  const al4JsonPath = path.resolve('docs/review/al4_candidates_data.json');
  if (!fs.existsSync(al4JsonPath)) {
    throw new Error(`File not found: ${al4JsonPath}`);
  }

  const al4Data = JSON.parse(fs.readFileSync(al4JsonPath, 'utf-8')) as Al4Data;
  const candidateKeys = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

  const candidateLabels: Record<string, string> = {
    A1: 'A1: حد ضرر متحرک پویا بر پایه‌ی ATR',
    A2: 'A2: پول‌بک به کیجون + کراس استوک',
    A3: 'A3: فیلتر رژیم نوسان (ATR/Close > میانه ۱۰۰)',
    A4: 'A4: انطباق روند روزانه (1d Strict)',
    A5: 'A5: تعیین حجم بر پایه‌ی نوسان (Risk 0.5% / Stop)',
    A6: 'A6: ترکیب دو کاندیدای برتر',
  };

  const results: Record<string, CandidateGateCDiag> = {};

  for (const cKey of candidateKeys) {
    const marketDiags: MarketGateCDiag[] = [];
    let violatingCount = 0;

    let worstDDMarket = '';
    let maxDDVal = -1;
    let worstDDBaseline = 0;

    let worstRatioMarket = '';
    let maxRatioVal = -1;
    let worstRatioCandDD = 0;
    let worstRatioBaseDD = 0;

    for (const m of al4Data.markets) {
      const bMaxDD = m.baseline.real.maxDD;
      const cMaxDD = m.candidates[cKey]?.real?.maxDD ?? 0;
      const ratio = bMaxDD > 0 ? roundTo(cMaxDD / bMaxDD, 2) : 1.0;

      const violatedRatio = bMaxDD > 0 && cMaxDD > bMaxDD * 1.2;
      const violatedCap20 = cMaxDD > 20.0;

      let violationType: GateCViolationType = 'none';
      if (violatedRatio && violatedCap20) {
        violationType = 'both';
      } else if (violatedRatio) {
        violationType = 'ratio_1_2';
      } else if (violatedCap20) {
        violationType = 'cap_20';
      }

      if (violationType !== 'none') {
        violatingCount++;
      }

      if (cMaxDD > maxDDVal) {
        maxDDVal = cMaxDD;
        worstDDMarket = m.market;
        worstDDBaseline = bMaxDD;
      }

      if (ratio > maxRatioVal) {
        maxRatioVal = ratio;
        worstRatioMarket = m.market;
        worstRatioCandDD = cMaxDD;
        worstRatioBaseDD = bMaxDD;
      }

      marketDiags.push({
        market: m.market,
        isOos: m.isOos,
        baselineMaxDD: bMaxDD,
        candidateMaxDD: cMaxDD,
        ratio,
        violatedRatio,
        violatedCap20,
        violationType,
      });
    }

    const summary = al4Data.summaries.find((s) => s.name === cKey);
    const avgRealMaxDD = summary ? summary.realMaxDDAvg : 0;
    const baselineAvg = al4Data.metadata.baselineRealMaxDDAvg;

    // Interpretation 1: Average only
    const passOnAverage = avgRealMaxDD <= 1.2 * baselineAvg && avgRealMaxDD <= 20.0;
    // Interpretation 2: Per-market check (what code implemented)
    const passOnIndividualMarkets = violatingCount === 0;

    results[cKey] = {
      candidateKey: cKey,
      label: candidateLabels[cKey] ?? cKey,
      avgRealMaxDD,
      baselineAvgRealMaxDD: baselineAvg,
      passOnAverage,
      passOnIndividualMarkets,
      officialVerdict: passOnAverage && passOnIndividualMarkets,
      violatingMarketCount: violatingCount,
      totalMarkets: al4Data.markets.length,
      worstMarketByMaxDD: {
        market: worstDDMarket,
        candidateMaxDD: maxDDVal,
        baselineMaxDD: worstDDBaseline,
      },
      worstMarketByRatio: {
        market: worstRatioMarket,
        ratio: maxRatioVal,
        candidateMaxDD: worstRatioCandDD,
        baselineMaxDD: worstRatioBaseDD,
      },
      markets: marketDiags,
    };
  }

  // Write JSON artifact
  const jsonOutPath = path.resolve('docs/review/AL4_GATE_DIAG.json');
  fs.writeFileSync(jsonOutPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Diagnostic JSON saved to: ${jsonOutPath}`);

  // Build Markdown Diagnostic Report
  let md = `# گزارش تشخیصی شرط (ج) برای کاندیداهای AL4 (AL4_GATE_DIAG.md)\n\n`;
  md += `این سند تحلیل تشخیصی دقیق قیدهای افت سرمایه (شرط ج: $\\text{MaxDD} \\le 1.2 \\times \\text{Base}$ و $\\text{MaxDD} \\le 20\\%$) را در دو سطح ارائه می‌دهد:\n`;
  md += `1. **تفسیر ۱: شرط ج بر روی میانگین کل ۱۴ بازار** (صرفاً اطلاعاتی و غیرالزام‌آور).\n`;
  md += `2. **تفسیر ۲: شرط ج بر روی تک‌تک بازارها** (تفسیر رسمی پیاده‌شده در کد: هر ۱۴ بازار باید قید را رعایت کنند).\n\n`;
  md += `> [!IMPORTANT]\n`;
  md += `> طبق بند ۳ قوانین و مأموریت، **حکم رسمی کد هیچ تغییری نمی‌کند**. هدف از این سند شفاف‌سازی علت عدم تطابق ظاهری میانگین‌های عددی با نشانگرهای ✅/❌ در جدول خلاصه است.\n\n`;
  md += `---\n\n`;

  md += `## ۱. جدول مقایسه دو تفسیر شرط ج به تفکیک کاندیداها\n\n`;
  md += `| کاندیدا | میانگین MaxDD واقعی | MaxDD پایه | تفسیر ۱ (روی میانگین - اطلاعاتی) | تفسیر ۲ (روی تک‌تک بازارها - کد رسمی) | تعداد بازارهای ناقض از ۱۴ | بدترین بازار بر اساس MaxDD | بدترین بازار بر اساس نسبت |\n`;
  md += `|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|\n`;

  for (const cKey of candidateKeys) {
    const r = results[cKey];
    const t1 = r.passOnAverage ? '✅ PASS' : '❌ FAIL';
    const t2 = r.passOnIndividualMarkets ? '✅ PASS' : '❌ FAIL';
    const worstDD = `${r.worstMarketByMaxDD.market} (${r.worstMarketByMaxDD.candidateMaxDD}%)`;
    const worstRatio = `${r.worstMarketByRatio.market} (${r.worstMarketByRatio.ratio}x)`;

    md += `| **${cKey}** | \`${r.avgRealMaxDD}%\` | \`${r.baselineAvgRealMaxDD}%\` | ${t1} | **${t2}** | **${r.violatingMarketCount} / 14** | ${worstDD} | ${worstRatio} |\n`;
  }

  md += `\n---\n\n`;
  md += `## ۲. جدول جزئیات تفکیکی ۱۴ بازار برای هر کاندیدا\n\n`;

  const violationDesc = (v: GateCViolationType, ratio: number, candDD: number): string => {
    if (v === 'none') return '✅ رعایت شده';
    if (v === 'ratio_1_2') return `❌ نقض قید ۱.۲ برابر (${ratio}x > 1.2x)`;
    if (v === 'cap_20') return `❌ نقض سقف ۲۰٪ (${candDD}% > 20%)`;
    return `❌ نقض هر دو قید (${ratio}x > 1.2x و ${candDD}% > 20%)`;
  };

  for (const cKey of candidateKeys) {
    const r = results[cKey];
    md += `### ۲.${candidateKeys.indexOf(cKey) + 1}. کاندیدای ${cKey}: ${r.label}\n\n`;
    md += `- **تعداد بازارهای ناقض:** ${r.violatingMarketCount} از ${r.totalMarkets}\n`;
    md += `- **بدترین بازار از نظر افت مطلق:** \`${r.worstMarketByMaxDD.market}\` با افت \`${r.worstMarketByMaxDD.candidateMaxDD}%\` (پایه: \`${r.worstMarketByMaxDD.baselineMaxDD}%\`)\n`;
    md += `- **بدترین بازار از نظر تشدید افت:** \`${r.worstMarketByRatio.market}\` با نسبت \`${r.worstMarketByRatio.ratio} برابر\` (پایه: \`${r.worstMarketByRatio.baselineMaxDD}%\` $\\rightarrow$ کاندیدا: \`${r.worstMarketByRatio.candidateMaxDD}%\`)\n\n`;

    md += `| بازار | نوع | MaxDD پایه | MaxDD کاندیدا | نسبت (کاندیدا/پایه) | وضعیت قید شرط ج |\n`;
    md += `|:---:|:---:|:---:|:---:|:---:|:---:|\n`;

    for (const m of r.markets) {
      const oosTag = m.isOos ? 'OOS' : 'اصلی';
      md += `| **${m.market}** | ${oosTag} | \`${m.baselineMaxDD}%\` | \`${m.candidateMaxDD}%\` | \`${m.ratio}x\` | ${violationDesc(m.violationType, m.ratio, m.candidateMaxDD)} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;
  md += `## ۳. تحلیل علل نقض و چرایی سخت‌گیری شرط ج در تک‌تک بازارها\n\n`;
  md += `1. **کاندیدای A2 (پول‌بک کیجون):** با وجود اینکه میانگین افت کل ۱۴ بازار از ۱۵.۰۵٪ به ۷.۶۷٪ کاهش یافته (کاهش چشمگیر میانگین ریسک)، در بازارهایی مثل ETH 15m یا ADA 1h به علت کاهش تعداد معاملات یا توقف‌های مقطعی، نسبت MaxDD از ۱.۲ برابر پایه فراتر رفته است و همین امر موجب رد آن در ضابطه \`allRealMaxDdOk\` شده است.\n`;
  md += `2. **کاندیدای A4 (روند روزانه):** در فریم‌های بالاتر بسیار باثبات عمل می‌کند اما در بازارهای با نوسان مقطعی سقف ۲۰٪ یا ضریب ۱.۲x نقض شده است.\n`;
  md += `3. **کاندیدای A5 (سایزینگ نوسانی):** در بازارهای دارای نوسان شدید، بیشترین افت‌های سرمایه را تجربه کرده و سقف ۲۰٪ در چندین بازار نقض شده است.\n`;

  const mdOutPath = path.resolve('docs/review/AL4_GATE_DIAG.md');
  fs.writeFileSync(mdOutPath, md, 'utf-8');
  console.log(`Diagnostic Markdown report saved to: ${mdOutPath}`);
}

if (require.main === module) {
  runGateCDiagnostic();
}
