# گزارش اجرای مستقیم Pine Script فیشر و تطبیق محاسباتی (FISHER_PINE_RUN - RG0-f)

این گزارش مستندسازی اجرای مستقیم اسکریپت اصلی کاربر (`docs/reference/fisher-rsi-pinescript.pine.md` اندیکاتور FisherRSI اثر B3AR_Trades) بدون داده‌های تریدینگ‌ویو و تطبیق ۱۰۰٪ ریاضی آن با موتور محاسباتی پروژه است.

---

## ۱. فهرست بخش‌های حذفی (Non-Computational Stripping)
برای اجرای فایل Pine در موتور Node (`pinets`)، فقط بخش‌های بصری و هشداری که ارتباطی با مقادیر ریاضی اندیکاتور ندارند حذف شدند، بدون کوچک‌ترین دست‌کاری در فرمول‌های محاسباتی:
- **توابع پلات و رنگ‌آمیزی:** `plot()`، `plotshape()`، `plotcandle()`، `fill()`، `bgcolor()`.
- **هشدارهای صوتی و پیام‌ها:** `alertcondition()`.
- **کدهای تم رنگی و گرادیان:** `GRP_THEME`، `mix_color()`، `color.from_gradient()` و جداول نمایشی.
- **بخش‌های کاملاً حفظ‌شده (هسته محاسباتی دست‌نخورده):**
  - `ta.rsi(close, 14)` و `ta.sma(..., 1)`
  - `ta.highest(rsi_score, 10)` و `ta.lowest(rsi_score, 10)`
  - نرمال‌سازی موقعیت `(rsi_score - lowest) / range - 0.5`
  - هموارسازی نمایی فیشر: `fisher_value1 := 0.33 * 2 * position + 0.67 * nz(fisher_value1[1])`
  - محدودسازی قطعی: `math.max(math.min(fisher_value1, 0.999), -0.999)`
  - تبدیل فیشر: `fisher_transform := 0.5 * math.log((1 + value1) / (1 - value1)) + 0.5 * nz(transform[1])`
  - خط سیگنال: `fisher_signal = fisher_transform[1]`
  - مقیاس‌بندی: `50 + fisher_transform * 10`
  - شروط مناطق اشباع `score <= 30 or fisher_value_scaled <= 30` و `score >= 70 or fisher_value_scaled >= 70`
  - رویدادهای کراس: `ta.crossover` و `ta.crossunder` در دو حالت Any-Cross و Zone-Gated.

---

## ۲. مشخصات داده‌های ورودی
- **نماد و تایم‌فریم:** `BTCUSDT` تایم‌فریم `1h` از داده‌های محلی پروژه (`docs/review/data/BTCUSDT_1h.csv.gz`).
- **تعداد کندل متوالی:** ۵۰۰ کندل.
- **بازه زمانی دقیق:**
  - شروع: `2020-10-17T01:00:00.000Z` (timestamp: `1602896400000`)
  - پایان: `2020-11-06T20:00:00.000Z` (timestamp: `1604692800000`)
- **پارامترهای اجرایی:**
  - `RSI Length`: ۱۴
  - `RSI Smoothing`: ۱
  - `Fisher Length`: ۱۰
  - `Oversold Level`: ۳۰
  - `Overbought Level`: ۷۰

---

## ۳. اجرای دوگانه و مقایسه موتور PineTS با بازنویسی مستقل (Independent Port)
مطابق پروتکل RG0-f، هر دو روش به موازات هم اجرا شدند:
1. **روش اول (موتور پاین Node):** پکیج `pinets` نسخه 0.13.0.
2. **روش دوم (پورت مستقل خط‌به‌خط):** فایل `tools/fisher_independent.mjs` (بدون هیچ وابستگی یا import از `src/`).

### نتایج مقایسه بین دو موتور:
- **بیشینه خطای Fisher Scaled:** `8.50e-9` (صرفاً تفاوت ناشی از گردکردن ممیز شناور در سطح اعشار هشتم).
- **بیشینه خطای Signal Scaled:** `8.50e-9`.
- **تعداد عدم‌انطباق AnyCrossUp:** `0` از ۵۰۰ کندل (۱۰۰٪ تطابق).
- **تعداد عدم‌انطباق AnyCrossDown:** `0` از ۵۰۰ کندل (۱۰۰٪ تطابق).
- **تعداد عدم‌انطباق ZoneCrossUp:** `0` از ۵۰۰ کندل (۱۰۰٪ تطابق).
- **تعداد عدم‌انطباق ZoneCrossDown:** `0` از ۵۰۰ کندل (۱۰۰٪ تطابق).

---

## ۴. نتایج تطبیق با کد پروژه (`src/indicators/fisher-rsi.ts`)
تست راستی‌آزمایی در `tests/indicators/fisher-pine-run-parity.test.ts` با فیکسچر رسمی `tests/fixtures/fisher_pine_run.json`:
- **خطای مقیاس‌شده پس از دوره Warm-up (۱۰۰ کندل اول):** دقیقاً `0.00000000` (کمتر از آستانه `0.01`).
- **تطابق رویدادهای کراس:** ۱۰۰٪ انطباق کامل در تمام ۵۰۰ کندل برای هر چهار رویداد:
  - `anyCrossUp`: ۵۰۰/۵۰۰ منطبق (۱۰۰٪)
  - `anyCrossDown`: ۵۰۰/۵۰۰ منطبق (۱۰۰٪)
  - `zoneCrossUp`: ۵۰۰/۵۰۰ منطبق (۱۰۰٪)
  - `zoneCrossDown`: ۵۰۰/۵۰۰ منطبق (۱۰۰٪)

---

## ۵. نتیجه‌گیری و وضعیت در ماتریس نیازمندی‌ها
- **Fisher parity با اجرای مستقل Pine کاربر:** **`PASS (proof)`** (مدرک: ۵۰۰ کندل BTCUSDT 1h، بیشینه خطا 0.00، تطابق ۱۰۰٪ رویدادهای کراس).
- **Fisher golden از TradingView:** **`BLOCKED`** (کاربر داده‌ی خروجی تریدینگ‌ویو در اختیار ندارد؛ تست مربوطه در حالت Skip/Blocked تفکیک‌شده باقی مانده و مانع تست‌ها نیست).
