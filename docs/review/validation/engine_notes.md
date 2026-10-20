# Engine Mechanics & Execution Notes

- **Entry and Exit Execution Price**: Signal entries and reverse exits/entries execute at the current candle's `close` price. Intrabar stop-loss and trailing-stop exits execute at `stopPrice` (adjusted for slippage) as soon as the intrabar threshold is breached.
- **Stop Execution Price on Gaps**: If the candle opens beyond the stop price (`open <= stopPrice` for long or `open >= stopPrice` for short), the exit executes at `candle.open` to honor adverse price gaps rather than an artificial stop price.
- **Trailing Stop Mechanism**: Favorable price excursions are recorded from intrabar extremes (`high` for long, `low` for short). The trailing ratchet calculates new stop levels at candle close, and the updated stop becomes active for intrabar checking starting on the next candle.
- **Reverse Orders**: Position liquidation and opposite-direction entry occur atomically within the same candle at `candle.close`. Trading fees are assessed on both the closing position notional and the new opening position notional.
- **Slippage Placement**: Slippage is applied adversely to executed exit prices: selling long slips downward (`exitPrice * (1 - slippagePercent / 100)`), while covering short slips upward (`exitPrice * (1 + slippagePercent / 100)`).
- **Drawdown Calculation**: Maximum Drawdown is calculated across the sequence of candle-close equity values (`portfolio.getTotalEquity(candle.close)`) relative to historical peak equity, measuring closed-candle drawdown rather than intrabar equity excursions.
