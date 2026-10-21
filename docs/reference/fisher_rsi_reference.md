# Fisher RSI Reference Template

## نام / نویسنده / لینک (Name / Author / Link)
- **نام اندیکاتور:** FisherRSI
- **نویسنده:** 
- **لینک مرجع TradingView:** 

## کد Pine (Pine Script)
```pinescript
// Pine Script v6 Reference Template
//@version=6
indicator('FisherRSI', shorttitle = 'FRSI', overlay = false)

rsi_source = input.source(close, 'RSI Source')
rsi_length = input.int(14, 'RSI Length')
rsi_smoothing = input.int(1, 'RSI Smoothing')
oversold_level = input.int(30, 'Oversold Level')
overbought_level = input.int(70, 'Overbought Level')

fisher_length = input.int(10, 'Fisher Length')

rsi_score = ta.sma(ta.rsi(rsi_source, rsi_length), rsi_smoothing)

var float fisher_value1 = 0.0
var float fisher_transform = 0.0

fisher_highest = ta.highest(rsi_score, fisher_length)
fisher_lowest = ta.lowest(rsi_score, fisher_length)
fisher_range = fisher_highest - fisher_lowest

fisher_position = fisher_range != 0 ? (rsi_score - fisher_lowest) / fisher_range - 0.5 : 0.0
fisher_value1 := 0.33 * 2 * fisher_position + 0.67 * nz(fisher_value1[1])
fisher_value1 := math.max(math.min(fisher_value1, 0.999), -0.999)
fisher_transform := 0.5 * math.log((1 + fisher_value1) / (1 - fisher_value1)) + 0.5 * nz(fisher_transform[1])
fisher_signal = fisher_transform[1]
```

## تنظیمات (Settings)
- **RSI Source:** `close`
- **RSI Length:** `14`
- **RSI Smoothing:** `1`
- **Fisher Length:** `10`
- **Oversold Level:** `30`
- **Overbought Level:** `70`

## ۱۵ کندل و مقدارهای Fisher و Signal (15 Candles and Reference Fisher/Signal Values)
<!-- بخش خالی برای مقایسه و تایید هم‌خوانی داده‌های مرجع با تلورانس 1e-4 -->
| # | Timestamp | Open | High | Low | Close | Volume | Reference RSI | Reference Fisher | Reference Signal |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | |
| 2 | | | | | | | | | |
| 3 | | | | | | | | | |
| 4 | | | | | | | | | |
| 5 | | | | | | | | | |
| 6 | | | | | | | | | |
| 7 | | | | | | | | | |
| 8 | | | | | | | | | |
| 9 | | | | | | | | | |
| 10 | | | | | | | | | |
| 11 | | | | | | | | | |
| 12 | | | | | | | | | |
| 13 | | | | | | | | | |
| 14 | | | | | | | | | |
| 15 | | | | | | | | | |

*Status: UNVERIFIED: not compared to reference (Waiting for benchmark dataset).*
