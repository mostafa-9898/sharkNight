# Multi-Timeframe Strategy Validation Report (Candidates B & D)
> Generated: **2026-10-20T08:30:10.736Z** | Commit: `51ffe7ce` | Capital: $10,000 | Fee: 0.1% | Trailing: 3/3/1.5

### 1. Final Verdict Matrix (Candidates B & D@5%)
| Market | Cfg | Mode | C1: Test>0 | C2: NoBest>0 | C3: DD≤12% | C4: CostRob | C5: Null≥90 | Verdict |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `BTC_15m` | B | Long-Short | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `BTC_1h` | B | Long-Short | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `BTC_4h` | B | Long-Short | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `ETH_15m` | B | Long-Short | ✅ | ❌ | ❌ | ✅ | ❌ | FAIL |
| `ETH_1h` | B | Long-Short | ✅ | ❌ | ❌ | ❌ | ❌ | FAIL |
| `ETH_4h` | B | Long-Short | ✅ | ✅ | ✅ | ✅ | ❌ | FAIL |
| `BTC_15m` | D@5% | Long-Only (5%) | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `BTC_1h` | D@5% | Long-Only (5%) | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `BTC_4h` | D@5% | Long-Only (5%) | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `ETH_15m` | D@5% | Long-Only (5%) | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `ETH_1h` | D@5% | Long-Only (5%) | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |
| `ETH_4h` | D@5% | Long-Only (5%) | ✅ | ✅ | ✅ | ✅ | ✅ | **PASS** |

### Verdict Summary
| Candidate | Strategy Definition | Passed Markets (/6) | BTC Viable | ETH Viable | Final Status |
|---|---|:---:|:---:|:---:|:---:|
| **Candidate B** | Dual Filter, Long-Short Trailing 3/3/1.5 | 3 / 6 | ✅ Yes | ❌ No | **REJECTED** |
| **Candidate D@5%** | Dual Filter, Long-Only Trailing 3/3/1.5, Size 5% | 6 / 6 | ✅ Yes | ✅ Yes | **ACCEPTED** |

### 2. Random-Entry Null Hypothesis Test (Trailing Exits, 200 Sims)
| Market | Cfg | Actual Trades | Avg Sim Trades | Actual Ret% | Mean Null% | 95th Pct Null% | Actual Pctile | Null Pass (≥90) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `BTC_15m` | B | 71 | 65.5 | +27.5% | +4.1% | +13.9% | 100.0% | ✅ PASS |
| `BTC_15m` | D | 47 | 46.4 | +18.5% | +4.2% | +10.1% | 100.0% | ✅ PASS |
| `BTC_1h` | B | 71 | 71.6 | +23.3% | +5.0% | +16.1% | 98.0% | ✅ PASS |
| `BTC_1h` | D | 55 | 54.6 | +13.3% | +4.9% | +11.6% | 97.5% | ✅ PASS |
| `BTC_4h` | B | 58 | 57.3 | +26.5% | +4.3% | +14.4% | 100.0% | ✅ PASS |
| `BTC_4h` | D | 33 | 34.0 | +15.4% | +3.2% | +9.0% | 100.0% | ✅ PASS |
| `ETH_15m` | B | 181 | 176.0 | +11.3% | +4.8% | +17.3% | 85.5% | ❌ FAIL |
| `ETH_15m` | D | 93 | 87.4 | +10.8% | +3.9% | +8.3% | 100.0% | ✅ PASS |
| `ETH_1h` | B | 188 | 189.5 | -2.9% | +4.6% | +16.0% | 11.5% | ❌ FAIL |
| `ETH_1h` | D | 94 | 87.8 | +8.3% | +4.0% | +8.4% | 95.0% | ✅ PASS |
| `ETH_4h` | B | 95 | 98.5 | +6.7% | +3.6% | +13.8% | 72.5% | ❌ FAIL |
| `ETH_4h` | D | 50 | 47.3 | +8.7% | +2.2% | +6.5% | 99.0% | ✅ PASS |

### 3. Position Size Sensitivity Summary (Candidate D)
| Market | Size 5.0% (Ret% / MaxDD%) | Size 7.5% (Ret% / MaxDD%) | Size 10.0% (Ret% / MaxDD%) | Trades |
|---|:---:|:---:|:---:|:---:|
| `BTC_15m` | +18.5% (10.3%) | +28.2% (14.4%) | +38.3% (18.1%) | 47 |
| `BTC_1h` | +13.3% (10.1%) | +20.2% (14.2%) | +27.2% (17.8%) | 55 |
| `BTC_4h` | +15.4% (8.6%) | +23.6% (12.0%) | +32.1% (15.0%) | 33 |
| `ETH_15m` | +10.8% (4.9%) | +16.4% (7.1%) | +22.2% (9.2%) | 93 |
| `ETH_1h` | +8.3% (5.3%) | +12.6% (7.7%) | +17.0% (9.9%) | 94 |
| `ETH_4h` | +8.7% (3.5%) | +13.2% (5.1%) | +17.8% (6.7%) | 50 |

### 4. Out-of-Sample Coin Validation (Candidate D, Fixed Params)
| Sym | TF | Candles | Start Date | Ret% | MaxDD% | Trades | NoBest% | Random Pctile |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `SOL` | 1h | 45,670 | 2021-08-04 | +41.8% | 25.6% | 98 | +2.4% | 76.0% |
| `SOL` | 4h | 11,418 | 2021-08-04 | +39.6% | 26.7% | 67 | -0.1% | 84.8% |
| `BNB` | 1h | 52,596 | 2020-10-19 | +44.4% | 19.6% | 96 | +11.5% | 98.0% |
| `BNB` | 4h | 13,149 | 2020-10-19 | +2.5% | 12.1% | 75 | -2.6% | 28.3% |
| `XRP` | 1h | 52,596 | 2020-10-19 | +29.2% | 19.8% | 124 | +2.9% | 86.0% |
| `XRP` | 4h | 13,149 | 2020-10-19 | +23.0% | 19.1% | 68 | -2.5% | 83.5% |
| `ADA` | 1h | 52,596 | 2020-10-19 | +8.4% | 14.2% | 141 | -2.2% | 17.0% |
| `ADA` | 4h | 13,149 | 2020-10-19 | +20.0% | 14.3% | 68 | +5.7% | 82.0% |

### 5. Review Notes & Conclusions
- **Candidate D (Long-Only Trailing)** eliminates adverse short exposures during structural crypto bull regimes while maintaining tight maximum drawdowns.
- **Random Entry Null Distribution**: Null hypothesis calibration ensures simulated trade counts align within ±12% of actual strategy executions.
- **Out-of-Sample Robustness**: Fixed parameter candidate D demonstrates positive expectancy without parameter refitting on alternative large-cap assets.

### 6. Multi-Position Evaluation (M1–M4)
| Market | Cfg | Ret% | MaxDD% | Trades | NoTop3% | 2ndHalf% | AvgConc | WorstDay% | Pctile | Verdict |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `BTC_15m` | M1 | +19.5% | 9.8% | 42 | -1.1% | +6.2% | 0.8 | -2.2% | - | BASE |
| `BTC_15m` | M2 | +37.1% | 15.5% | 70 | +8.7% | +12.2% | 1.2 | -3.9% | - | FAIL |
| `BTC_15m` | M3 | +127.3% | 21.9% | 293 | +96.7% | +50.8% | 4.6 | -7.9% | 100% | FAIL |
| `BTC_15m` | M4 | +31.4% | 8.9% | 275 | +23.0% | +14.1% | 4.6 | -3.0% | - | **PASS** |
| `BTC_1h` | M1 | +8.7% | 4.7% | 55 | +0.2% | +5.5% | 0.6 | -1.7% | - | BASE |
| `BTC_1h` | M2 | +15.5% | 8.6% | 96 | +4.8% | +10.7% | 1.1 | -3.0% | - | FAIL |
| `BTC_1h` | M3 | +27.9% | 20.1% | 235 | +16.6% | +19.6% | 3.0 | -5.8% | 85% | FAIL |
| `BTC_1h` | M4 | +7.9% | 7.3% | 229 | +4.4% | +6.0% | 3.0 | -2.1% | - | FAIL |
| `BTC_4h` | M1 | +16.9% | 8.2% | 28 | +2.8% | +4.7% | 0.6 | -2.2% | - | BASE |
| `BTC_4h` | M2 | +24.4% | 8.3% | 55 | +9.3% | +7.3% | 1.0 | -2.6% | - | **PASS** |
| `BTC_4h` | M3 | +24.1% | 10.8% | 132 | +9.0% | +6.1% | 1.5 | -3.6% | 96% | **PASS** |
| `BTC_4h` | M4 | +7.0% | 3.5% | 132 | +2.6% | +1.9% | 1.5 | -1.2% | - | FAIL |
| `ETH_15m` | M1 | +11.3% | 5.0% | 85 | +2.6% | +7.1% | 0.5 | -2.3% | - | BASE |
| `ETH_15m` | M2 | +19.6% | 8.2% | 168 | +9.7% | +13.9% | 1.0 | -4.3% | - | **PASS** |
| `ETH_15m` | M3 | +62.9% | 23.2% | 472 | +52.4% | +59.1% | 3.0 | -9.2% | 100% | FAIL |
| `ETH_15m` | M4 | +17.4% | 8.9% | 463 | +14.3% | +16.1% | 3.0 | -3.2% | - | FAIL |
| `ETH_1h` | M1 | +5.6% | 6.3% | 88 | -1.1% | +3.6% | 0.4 | -2.3% | - | BASE |
| `ETH_1h` | M2 | +7.2% | 10.0% | 156 | +0.5% | +7.8% | 0.7 | -2.7% | - | FAIL |
| `ETH_1h` | M3 | +16.6% | 17.0% | 277 | +9.6% | +23.4% | 1.4 | -8.5% | 68% | FAIL |
| `ETH_1h` | M4 | +5.0% | 6.1% | 276 | +3.0% | +6.7% | 1.4 | -3.0% | - | FAIL |
| `ETH_4h` | M1 | +7.6% | 3.5% | 49 | +0.0% | +6.5% | 0.4 | -1.9% | - | BASE |
| `ETH_4h` | M2 | +10.1% | 5.6% | 84 | +2.2% | +11.1% | 0.6 | -3.0% | - | FAIL |
| `ETH_4h` | M3 | +12.5% | 9.6% | 138 | +4.9% | +15.2% | 0.9 | -3.2% | 88% | FAIL |
| `ETH_4h` | M4 | +3.9% | 3.2% | 137 | +1.6% | +4.5% | 0.9 | -1.0% | - | FAIL |

### Multi-Position Global Verdict
| Config | Parameters | BTC/ETH Passed (/6) | Global Status |
|---|---|:---:|:---:|
| **M2** | maxPos 3, size 5%, cap 15% | 2 / 6 | **FAIL** |
| **M3** | maxPos 10, size 5%, cap 50% | 1 / 6 | **FAIL** |
| **M4** | maxPos 10, size 1.5%, cap 15% | 1 / 6 | **FAIL** |
