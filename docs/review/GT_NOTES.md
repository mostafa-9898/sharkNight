# یادداشت‌های اجرایی و مبنای مأموریت بازبینی گیت (GT_NOTES.md)

این سند گزارش تمامی دستورات، خروجی‌های واقعی، تصمیمات محافظه‌کارانه و بررسی‌های فنی در طول مأموریت GT است. طبق قانون ۱، هر عددی که در گزارش آمده از خروجی واقعی یک دستور ثبت شده است.

---

## مرحله ۰: خط مبنا و قطعی‌بودن (Stage 0: Baseline & Determinism)

### ۱. بررسی سلامت ابزارها و تست‌ها (Clean Baseline Checks)
- **بررسی نوع‌سنجی TypeScript:**
  - دستور: `npx tsc --noEmit`
  - نتیجه اولیه: خطاهای TS در اسکریپت‌های AL3, AL4, RC3, RC4.
  - اصلاحات نوع A: رفع ایمپورت‌های نابجا و رفع خطای `as const.sort()` در AL4.
  - نتیجه نهایی: `Exit Code 0` (کاملاً سبز بدون خطا).
- **بررسی کدنویسی ESLint:**
  - دستور: `npx eslint .`
  - نتیجه اولیه: ۸۶ مورد مشکل (شامل فرار نامناسب کاراکترها در تمپلیت‌های لاتک در RC3/RC4/RC6 و استفاده از `any`).
  - اصلاحات نوع A: اصلاح `include` در `tsconfig.json`، اصلاح فرارهای `\\mu`, `\\sigma`, `\\mapsto`, `\\ge`، حذف متغیرهای بی‌استفاده و تایپ‌دهی دقیق داده‌ها.
  - نتیجه نهایی: `Exit Code 0` (صفر خطا، صفر هشدار).
- **اجرای تمامی آزمون‌های واحد و یکپارچگی:**
  - دستور: `npm test`
  - خروجی واقعی:
    ```text
    Test Suites: 39 passed, 39 total
    Tests:       1 skipped, 356 passed, 357 total
    Snapshots:   0 total
    Time:        22.843 s
    ```
    (کاملاً سبز، ۱ آزمون skip شده مربوط به فیکسچر فیشر در غیاب داده طلایی است).

### ۲. اعتبارسنجی قطعی‌بودن خروجی‌ها (Determinism & Hash Parity)
- دستور اجرا: `npx tsx src/scripts/run-al4-candidates.ts`
- **کشف منبع غیرقطعی‌بودن:**
  در اجرای اولیه، هش فایل `AL4_CANDIDATES.md` در دو اجرا برابر بود اما هش `al4_candidates_data.json` به دلیل استفاده از `new Date().toISOString()` در خط ۵۱۸ برای فیلد `metadata.generatedAt` در هر اجرا تغییر می‌کرد.
- **اصلاح نوع A:**
  مقدار `generatedAt` به صورت قطعی و ثابت `'2026-10-24T12:00:00.000Z'` تثبیت شد.
- **مقایسه هش خروجی‌ها پس از اصلاح در دو اجرای متوالی:**
  - دستور محاسبه هش:
    `powershell -Command "Get-FileHash docs/review/AL4_CANDIDATES.md, docs/review/al4_candidates_data.json -Algorithm SHA256 | Format-List Path, Hash"`
  - **اجرای ۱ (Pass 1):**
    - `docs/review/AL4_CANDIDATES.md`:
      `91558E2503E690ADE74E4E446BCC0970E7195C3E70B098EE7224E944977F6153`
    - `docs/review/al4_candidates_data.json`:
      `5E098600840509ABAD518DB7530137130E7B6D9B6F81498DFB52077CA372C4FA`
  - **اجرای ۲ (Pass 2):**
    - `docs/review/AL4_CANDIDATES.md`:
      `91558E2503E690ADE74E4E446BCC0970E7195C3E70B098EE7224E944977F6153`
    - `docs/review/al4_candidates_data.json`:
      `5E098600840509ABAD518DB7530137130E7B6D9B6F81498DFB52077CA372C4FA`
  - **نتیجه:** هر دو فایل در دو اجرای مجزا بیت‌به‌بیت و به طور ۱۰۰٪ قطعی یکسان هستند (Exact Match).
