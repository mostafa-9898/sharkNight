# گزارش بازتولیدپذیری و رفع مغایرت S1 و SH4 (REPRO_SH)

## ۱. شرح مغایرت اولیه بین S1 و SH4 (TR3)
در گزارش‌های قبلی، نتایج اجرای استراتژی روی جفت‌ارز بیت‌کوین در دو اسکریپت `run-s1-s2-validation.ts` و `run-sh4-variants.ts` برای واریانت مبنا (TR3 با تریلینگ‌استاپ ۵/۳/۱.۵) دارای مغایرت آماری به شرح زیر بود:

- **S1 در اعتبارسنجی (`run-s1-s2-validation.ts`):**
  - بازده کل: `+37.29%`
  - بیشینه افت سرمایه (MaxDD): `16.44%`
  - کل معاملات: `544` (لانگ: ۲۸۵، شورت: ۲۵۹)
- **TR3 در ارزیابی واریانت‌های شورت (`run-sh4-variants.ts` نسخه اولیه):**
  - بازده کل: `+64.81%`
  - بیشینه افت سرمایه (MaxDD): `36.24%`
  - کل معاملات: `693` (لانگ: ۳۰۷، شورت: ۳۸۶)

---

## ۲. ریشه‌یابی فنی علت مغایرت (Root Cause)
با بررسی دقیق کد منبع اسکریپت‌های اجرایی، دو عامل تفاوت در پیکربندی استراتژی شناسایی گردید:

1. **فیلترهای شیب کیجون و ساختار سووینگ (`kijunSlopeFilter` و `structureFilter`):**
   - در `run-s1-s2-validation.ts`، فیلترهای `kijunSlopeFilter: true` و `structureFilter: true` صراحتاً فعال بودند.
   - در `run-sh4-variants.ts`، این دو پارامتر پاس داده نشده بودند و در سازنده کلاس `MultiTimeframeStrategy` مقدار پیش‌فرض آنها در غیاب آرگومان `false` بود. حذف این دو فیلتر موجب صدور سیگنال‌های اضافی (۶۹۳ معامله به جای ۵۴۴ معامله) و افزایش ریسک و افت سرمایه شده بود.
2. **ارسال تایم‌فریم‌های بالاتر روی بازه ۴ ساعته:**
   - در `run-sh4-variants.ts`، کندل‌های `htf1hCandles` و `htf4hCandles` برای تایم‌فریم‌های بالاتر به صورت شرطی ارسال می‌شدند و در تایم‌فریم ۴ ساعته مقدار `undefined` می‌گرفتند.

---

## ۳. اصلاح اعمال‌شده (Resolution)
اسکریپت `src/scripts/run-sh4-variants.ts` اصلاح شد به طوری که در نمونه‌سازی `MultiTimeframeStrategy` برای هر دو بخش واریانت‌ها و long-only:
```typescript
const strategy = new MultiTimeframeStrategy({
  htfMode: 'strict',
  entryMode: 'cross',
  fisherMode: 'confirm',
  fisherKind: 'fisher',
  fisherGate: 'none',
  htf1hCandles: c1h,
  htf4hCandles: c4h,
  kijunSlopeFilter: true,
  structureFilter: true,
  shortEntryFilter: variant.shortEntryFilter,
  daily1dCandles: dailyCandles,
  dailyRegimeCalculator: regCalc,
});
```

---

## ۴. اثبات تطابق عددی کامل (Verification & Parity Proof)
پس از اعمال اصلاح، اجرای همزمان موتور بک‌تست با تنظیمات هر دو اسکریپت بر روی BTC 15m و BTC 4h نتایج کاملاً منطبق و دقیقاً یکسان داد:

| بازار | پیکربندی | بازده کل % | MaxDD % | کل معاملات | معاملات لانگ | معاملات شورت |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **BTC 15m** | S1 Validation | `+37.29%` | `16.44%` | `544` | `285` | `259` |
| **BTC 15m** | SH4 TR3 Baseline | `+37.29%` | `16.44%` | `544` | `285` | `259` |
| **BTC 4h** | S1 Validation | `+10.27%` | `7.63%` | `197` | `122` | `75` |
| **BTC 4h** | SH4 TR3 Baseline | `+10.27%` | `7.63%` | `197` | `122` | `75` |

تست خودکار انطباق در `tests/backtest/repro-s1-vs-sh4.test.ts` اضافه شد و با موفقیت ۱۰۰٪ پاس شد.
