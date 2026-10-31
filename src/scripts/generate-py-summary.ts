import fs from 'fs';
import path from 'path';

export function generatePySummary() {
  const dataPath = path.resolve('docs/review/py_data.json');
  const outputPath = path.resolve('docs/review/PY_SUMMARY.md');

  const pyData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const records: any[] = pyData.records;
  const sensConc: any[] = pyData.concurrencySensitivity;
  const sensSize: any[] = pyData.sizeSensitivity;
  const baselines = pyData.baselinesComparison;

  // Criteria calculations
  const unseenPrimary = records.filter((r) => !r.isOos && !r.isSeen);
  const oosRecords = records.filter((r) => r.isOos);
  const p1Wins = unseenPrimary.filter(
    (r) => r.c1l.real.retDdRatio >= r.f3l.real.retDdRatio
  ).length;
  const oosWins = oosRecords.filter(
    (r) => r.c1l.real.retDdRatio >= r.f3l.real.retDdRatio
  ).length;

  const c1lD2Rets = records.map((r) => r.c1l.d2.totalReturn);
  const f3lD2Rets = records.map((r) => r.f3l.d2.totalReturn);
  const c1lD2Mean = (c1lD2Rets.reduce((a, b) => a + b, 0) / c1lD2Rets.length).toFixed(2);
  const f3lD2Mean = (f3lD2Rets.reduce((a, b) => a + b, 0) / f3lD2Rets.length).toFixed(2);
  const d2Pos = records.filter((r) => r.c1l.d2.totalReturn > 0).length;

  const n1Pass = records.filter((r) => r.null1l.c1lPercentile >= 75).length;
  const n2Pass = records.filter((r) => r.null2l.c1lPercentile >= 75).length;

  const nonSeen = records.filter((r) => !r.isSeen);
  const violating: string[] = [];
  let ddPass = 0;
  for (const r of nonSeen) {
    const isUnder20 = r.c1l.real.maxDD <= 20.0;
    const isUnderRatio = r.c1l.real.maxDD <= 1.2 * r.f3l.real.maxDD;
    if (isUnder20 && isUnderRatio) {
      ddPass++;
    } else {
      violating.push(
        `${r.key} (${r.c1l.real.maxDD}% ${!isUnder20 ? '> 20%' : `> 1.2×${r.f3l.real.maxDD}%`})`
      );
    }
  }

  const lines: string[] = [];
  lines.push('# خلاصه ارزیابی تجربی کاندیدای یک‌سویه لانگ (PY_SUMMARY - C1L)');
  lines.push('');
  lines.push('> **مبنای پیش‌ثبت**: [PREREGISTERED_PY.md](./PREREGISTERED_PY.md) | **افشا**: طراحی پس از مشاهده شکست شورت‌ها؛ بازار BTC 15m از پیش مشاهده شده بود.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۱. کارنامه ارزیابی شروط چهارگانه الزامی (Acceptance Scorecard)');
  lines.push('');
  lines.push('| شرط | شرح معیار ریاضی پیش‌ثبت | نتیجه تجربی حاصل | وضعیت |');
  lines.push('|:---:|---|---|:---:|');
  lines.push(`| **۱** | برتری Ret/DD نسبت به F3L: نادیده اصلی $\\ge 4/5$ و OOS $\\ge 5/8$ | نادیده اصلی: **${p1Wins}/5** ، خارج نمونه: **${oosWins}/8** | **FAIL** |`);
  lines.push(`| **۲** | پایداری D2: میانگین C1L > F3L و مثبت در $\\ge 10/14$ بازار | میانگین C1L برابر **+${c1lD2Mean}%** در برابر F3L برابر **+${f3lD2Mean}%**؛ مثبت در **${d2Pos}/14** بازار | **PASS (proof)** |`);
  lines.push(`| **۳** | معناداری آماری: صدک $\\ge 75\\%$ در $\\ge 8/14$ برای هر دو Null-1L و Null-2L | نال-۱L در **${n1Pass}/14** بازار؛ نال-۲L در **${n2Pass}/14** بازار | **FAIL** |`);
  lines.push(`| **۴** | افت سرمایه: maxDD $\\le 20\\%$ و $\\le 1.2\\times$ F3L در $\\ge 8/13$ بازار (بدون BTC 15m) | احراز در **${ddPass} از ۱۳** بازار؛ ناقض: ${violating.length} بازار | **FAIL** |`);
  lines.push('');
  lines.push(`> **بازارهای ناقض شرط ۴**: ${violating.join('، ')}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۲. حساسیت همزمانی و اندازه پوزیشن در ۶ بازار اصلی');
  lines.push('');
  lines.push('| بازار | MaxOpen=3 (Cap 20/30) | MaxOpen=5 (Cap 20/30) | MaxOpen=10 (Cap 20/30) | Size=1% Ret/DD | Size=2% Ret/DD | Size=3% Ret/DD |');
  lines.push('|---|---|---|---|---|---|---|');

  const primaryKeys = ['BTC 15m', 'BTC 1h', 'BTC 4h', 'ETH 15m', 'ETH 1h', 'ETH 4h'];
  for (const pk of primaryKeys) {
    const seenLabel = pk === 'BTC 15m' ? ' *(دیده شده)*' : '';
    const getConc = (mo: number, cap: number) => {
      const it = sensConc.find((x) => x.market === pk && x.maxOpen === mo && x.maxExposure === cap);
      return it ? `${it.totalReturn > 0 ? '+' : ''}${it.totalReturn}%` : '-';
    };
    const mo3 = `${getConc(3, 20)} / ${getConc(3, 30)}`;
    const mo5 = `${getConc(5, 20)} / ${getConc(5, 30)}`;
    const mo10 = `${getConc(10, 20)} / ${getConc(10, 30)}`;

    const getSize = (sz: number) => {
      const it = sensSize.find((x) => x.market === pk && x.sizePercent === sz);
      return it ? `${it.totalReturn > 0 ? '+' : ''}${it.totalReturn}% / ${it.maxDD}% (${it.retDdRatio})` : '-';
    };

    lines.push(`| **${pk}**${seenLabel} | ${mo3} | ${mo5} | ${mo10} | ${getSize(1)} | ${getSize(2)} | ${getSize(3)} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۳. مقایسه آماری استوار با خطوط مبنا (۱۴ بازار)');
  lines.push('');
  lines.push('| استراتژی | میانه بازده | میانگین بریده‌شده (۲۰٪) | میانه MaxDD | میانگین بریده‌شده MaxDD | میانه Ret/DD | میانگین بریده‌شده Ret/DD |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|');

  const renderBaselineRow = (name: string, b: any, bold = false) => {
    const wrap = (val: string | number) => (bold ? `**${val}**` : `${val}`);
    lines.push(
      `| ${wrap(name)} | ${wrap((b.medianRet > 0 ? '+' : '') + b.medianRet + '%')} | ${wrap((b.trimmedRet > 0 ? '+' : '') + b.trimmedRet + '%')} | ${wrap(b.medianDD + '%')} | ${wrap(b.trimmedDD + '%')} | ${wrap(b.medianRetDd)} | ${wrap(b.trimmedRetDd)} |`
    );
  };

  renderBaselineRow('C1L (Long-Only)', baselines.c1l, true);
  renderBaselineRow('F3L (S1L رسمی)', baselines.f3l);
  renderBaselineRow('F0L (بدون فیشر)', baselines.f0l);
  renderBaselineRow('B4 (HTF Strict)', baselines.b4);
  renderBaselineRow('B1 (Buy & Hold 30%)', baselines.b1);

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ۴. حکم نهایی و تصمیم مهندسی (Final Verdict)');
  lines.push('');
  lines.push('> ### حکم صریح: **رد قطعی کاندیدای C1L (REJECTED)**');
  lines.push('>');
  lines.push('> کاندیدای C1L از ۴ شرط الزامی، تنها در شرط ۲ (پایداری دترند) قبول شده و در **۳ شرط از ۴ شرط (شرط‌های ۱، ۳ و ۴) مردود (FAIL)** گردید:');
  lines.push('> 1. در بازارهای اصلی نادیده، برتری Ret/DD فقط در ۳ از ۵ بازار حاصل شد (نیاز به ۴ از ۵).');
  lines.push('> 2. نسبت به آزمون ورود تصادفی (Null-1L) فقط در ۴ از ۱۴ بازار به صدک ۷۵ رسید (عدم معناداری زمان‌بندی ورود).');
  lines.push('> 3. در مهار افت سرمایه، به دلیل همزمانی پوزیشن‌ها افت بیش از ۱.۲ برابر F3L در ۱۱ بازار از ۱۳ بازار رخ داد.');
  lines.push('>');
  lines.push('> **تصمیم نهایی کدبیس**: هیچ تغییری در تنظیمات پیش‌فرض `src/config/defaults.ts` اعمال نخواهد شد.');
  lines.push('');

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  console.log(`Generated ${outputPath} successfully (${lines.length} lines)`);
}

if (require.main === module) {
  generatePySummary();
}

