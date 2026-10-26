import type { SignalFunnel } from './types';

export interface FunnelStageRow {
  id: string;
  stepNumber: number;
  name: string;
  desc: string;
  longCount: number | string;
  longDrop: string;
  shortCount: number | string;
  shortDrop: string;
  combinedCount: number | string;
  combinedDrop: string;
  highlight?: boolean;
  rejectionBreakdown?: {
    long: { max_positions: number; max_exposure: number; min_bars: number; opposite_not_allowed: number; other: number };
    short: { max_positions: number; max_exposure: number; min_bars: number; opposite_not_allowed: number; other: number };
  };
}

export function calcDrop(prev: number, curr: number): string {
  if (prev <= 0) return '0.0%';
  const drop = ((prev - curr) / prev) * 100;
  return `${Math.max(0, drop).toFixed(1)}%`;
}

export function getFunnelStages(funnel: SignalFunnel): FunnelStageRow[] {
  const long = funnel.long;
  const short = funnel.short;

  const longRawTk = long.raw?.tk ?? 0;
  const longRawStoch = long.raw?.stoch ?? 0;
  const longRawFisher = long.raw?.fisher ?? 0;

  const shortRawTk = short.raw?.tk ?? 0;
  const shortRawStoch = short.raw?.stoch ?? 0;
  const shortRawFisher = short.raw?.fisher ?? 0;

  const combinedCandidate = long.candidate + short.candidate;
  const combinedPassHtf = long.passHtf + short.passHtf;
  const combinedPassKijun = long.passKijunSlope + short.passKijunSlope;
  const combinedPassStruct = long.passStructure + short.passStructure;
  const combinedPassOpp = long.passOppositeBlock + short.passOppositeBlock;
  const combinedPassFish = long.passFisherConfirm + short.passFisherConfirm;
  const combinedSignalEmitted = long.signalEmitted + short.signalEmitted;
  const combinedEntryAttempted = long.entryAttempted + short.entryAttempted;
  const combinedRejectedTotal = long.rejectedTotal + short.rejectedTotal;
  const combinedExecuted = long.executed + short.executed;

  return [
    {
      id: 'raw',
      stepNumber: 1,
      name: '1. Raw Crosses (Active Triggers)',
      desc: 'کراس خام ماشه‌های فعال (TK / Stoch / Fisher)',
      longCount: `TK: ${longRawTk} | Stoch: ${longRawStoch} | Fisher: ${longRawFisher}`,
      longDrop: '-',
      shortCount: `TK: ${shortRawTk} | Stoch: ${shortRawStoch} | Fisher: ${shortRawFisher}`,
      shortDrop: '-',
      combinedCount: `TK: ${longRawTk + shortRawTk} | Stoch: ${longRawStoch + shortRawStoch} | Fisher: ${longRawFisher + shortRawFisher}`,
      combinedDrop: '-',
    },
    {
      id: 'candidate',
      stepNumber: 2,
      name: '2. Candidate Candles',
      desc: 'کندل‌هایی با حداقل یک ماشه فعال در جهت مربوطه',
      longCount: long.candidate,
      longDrop: '-',
      shortCount: short.candidate,
      shortDrop: '-',
      combinedCount: combinedCandidate,
      combinedDrop: '-',
    },
    {
      id: 'passHtf',
      stepNumber: 3,
      name: '3. Pass HTF Strict (1h & 4h)',
      desc: 'تطابق هم‌جهت با تایم‌فریم‌های بالاتر (1H & 4H)',
      longCount: long.passHtf,
      longDrop: calcDrop(long.candidate, long.passHtf),
      shortCount: short.passHtf,
      shortDrop: calcDrop(short.candidate, short.passHtf),
      combinedCount: combinedPassHtf,
      combinedDrop: calcDrop(combinedCandidate, combinedPassHtf),
    },
    {
      id: 'passKijunSlope',
      stepNumber: 4,
      name: '4. Pass Kijun Slope',
      desc: 'شیب کیجون در جهت ورود',
      longCount: long.passKijunSlope,
      longDrop: calcDrop(long.passHtf, long.passKijunSlope),
      shortCount: short.passKijunSlope,
      shortDrop: calcDrop(short.passHtf, short.passKijunSlope),
      combinedCount: combinedPassKijun,
      combinedDrop: calcDrop(combinedPassHtf, combinedPassKijun),
    },
    {
      id: 'passStructure',
      stepNumber: 5,
      name: '5. Pass Structure Filter',
      desc: 'فیلتر شکست سقف/کف یا فیلتر ابر ایچیموکو',
      longCount: long.passStructure,
      longDrop: calcDrop(long.passKijunSlope, long.passStructure),
      shortCount: short.passStructure,
      shortDrop: calcDrop(short.passKijunSlope, short.passStructure),
      combinedCount: combinedPassStruct,
      combinedDrop: calcDrop(combinedPassKijun, combinedPassStruct),
    },
    {
      id: 'passOppositeBlock',
      stepNumber: 6,
      name: '6. Pass Opposite Block',
      desc: 'عدم وجود کراس متضاد در همان کندل',
      longCount: long.passOppositeBlock,
      longDrop: calcDrop(long.passStructure, long.passOppositeBlock),
      shortCount: short.passOppositeBlock,
      shortDrop: calcDrop(short.passStructure, short.passOppositeBlock),
      combinedCount: combinedPassOpp,
      combinedDrop: calcDrop(combinedPassStruct, combinedPassOpp),
    },
    {
      id: 'passFisherConfirm',
      stepNumber: 7,
      name: '7. Pass Fisher Confirm',
      desc: 'تاییدیه فیشر (در صورت فعال بودن حالت confirm/cross-confirm)',
      longCount: long.passFisherConfirm,
      longDrop: calcDrop(long.passOppositeBlock, long.passFisherConfirm),
      shortCount: short.passFisherConfirm,
      shortDrop: calcDrop(short.passOppositeBlock, short.passFisherConfirm),
      combinedCount: combinedPassFish,
      combinedDrop: calcDrop(combinedPassOpp, combinedPassFish),
    },
    {
      id: 'signalEmitted',
      stepNumber: 8,
      name: '8. Signal Emitted',
      desc: 'سیگنال معتبر تولیدشده توسط استراتژی',
      longCount: long.signalEmitted,
      longDrop: calcDrop(long.passFisherConfirm, long.signalEmitted),
      shortCount: short.signalEmitted,
      shortDrop: calcDrop(short.passFisherConfirm, short.signalEmitted),
      combinedCount: combinedSignalEmitted,
      combinedDrop: calcDrop(combinedPassFish, combinedSignalEmitted),
      highlight: true,
    },
    {
      id: 'entryAttempted',
      stepNumber: 9,
      name: '9. Entry Attempted',
      desc: 'تلاش ورود به معامله توسط موتور بک‌تست',
      longCount: long.entryAttempted,
      longDrop: calcDrop(long.signalEmitted, long.entryAttempted),
      shortCount: short.entryAttempted,
      shortDrop: calcDrop(short.signalEmitted, short.entryAttempted),
      combinedCount: combinedEntryAttempted,
      combinedDrop: calcDrop(combinedSignalEmitted, combinedEntryAttempted),
      highlight: true,
    },
    {
      id: 'rejected',
      stepNumber: 10,
      name: '10. Rejected by Engine (Breakdown)',
      desc: 'ردشده به تفکیک دلیل توسط قوانین مدیریت پوزیشن و ریسک',
      longCount: long.rejectedTotal,
      longDrop: calcDrop(long.entryAttempted, long.executed),
      shortCount: short.rejectedTotal,
      shortDrop: calcDrop(short.entryAttempted, short.executed),
      combinedCount: combinedRejectedTotal,
      combinedDrop: calcDrop(combinedEntryAttempted, combinedExecuted),
      rejectionBreakdown: {
        long: long.rejected,
        short: short.rejected,
      },
    },
    {
      id: 'executed',
      stepNumber: 11,
      name: '11. Executed Trades',
      desc: 'معاملات اجراشده نهایی (برابر با تعداد معاملات واقعی)',
      longCount: long.executed,
      longDrop: calcDrop(long.entryAttempted, long.executed),
      shortCount: short.executed,
      shortDrop: calcDrop(short.entryAttempted, short.executed),
      combinedCount: combinedExecuted,
      combinedDrop: calcDrop(combinedEntryAttempted, combinedExecuted),
      highlight: true,
    },
  ];
}

export function formatFunnelMarkdownTable(funnel: SignalFunnel): string {
  const stages = getFunnelStages(funnel);
  const lines: string[] = [];

  lines.push(`| Stage | Bullish (BUY) | Drop % | Bearish (SELL) | Drop % | Combined | Drop % |`);
  lines.push(`|---|---|---|---|---|---|---|`);

  for (const st of stages) {
    const bold = st.highlight ? '**' : '';
    lines.push(
      `| ${bold}${st.name}${bold} | ${bold}${st.longCount}${bold} | ${st.longDrop} | ${bold}${st.shortCount}${bold} | ${st.shortDrop} | ${bold}${st.combinedCount}${bold} | ${st.combinedDrop} |`
    );
  }

  lines.push(``);
  lines.push(`### Engine Rejection Breakdown`);
  const lRej = funnel.long.rejected;
  const sRej = funnel.short.rejected;
  lines.push(
    `- **Long Rejections (${funnel.long.rejectedTotal}):** max_positions=${lRej.max_positions}, max_exposure=${lRej.max_exposure}, min_bars=${lRej.min_bars}, opposite_not_allowed=${lRej.opposite_not_allowed}, other=${lRej.other}`
  );
  lines.push(
    `- **Short Rejections (${funnel.short.rejectedTotal}):** max_positions=${sRej.max_positions}, max_exposure=${sRej.max_exposure}, min_bars=${sRej.min_bars}, opposite_not_allowed=${sRej.opposite_not_allowed}, other=${sRej.other}`
  );

  return lines.join('\n');
}
