# Multi-Market Portfolio Simulation Report (D*)
> Capital: $10,000 | 12 Markets (BTC, ETH, SOL, BNB, XRP, ADA on 1h & 4h) | Trailing 5/3/1.5 (initial/step/raise) | Notional Cap 30%

### 1. Performance Overview & Acceptance Criteria
| Metric | P1 (No Brake, 5%) | P2 (Circuit Brake, 5%) | P3 (Circuit Brake, 2.5%) | Criterion |
|---|:---:|:---:|:---:|:---:|
| **Total Return** | +99.6% | +109.5% | +45.6% | > 0% |
| **Max Drawdown (Daily Close)** | 23.3% | 22.0% | 12.1% | ≤ 12.0% |
| **Return Without Top 3 Trades** | +45.0% | +53.3% | +21.7% | > 0% |
| **Losing Years (≤ 0%)** | 2 / 6 | 1 / 6 | 2 / 6 | ≤ 2 of 6 |
| **Max Entry Notional / Equity** | 30.0% | 30.0% | 15.0% | ≤ 30.0% |
| **Max Daily MTM Notional / Equity** | 52.8% | 52.8% | 31.0% | (Info) |
| **Executed Trades** | 564 | 506 | 544 | - |
| **Rejected Trades (Cap / Symbol / Brake)** | 281 (2 / 279 / 0) | 339 (2 / 252 / 85) | 301 (0 / 270 / 31) | - |
| **Verdict** | **FAIL** | **FAIL** | **FAIL** | All 5 met |

### 2. Yearly Returns Breakdown (2021–2026)
| Year | P1 (No Brake, 5%) | P2 (Circuit Brake, 5%) | P3 (Circuit Brake, 2.5%) |
|:---:|:---:|:---:|:---:|
| 2021 | +21.5% | +23.2% | +10.4% |
| 2022 | -11.8% | -10.2% | -4.8% |
| 2023 | +31.7% | +31.2% | +15.8% |
| 2024 | +22.8% | +24.2% | +11.3% |
| 2025 | -0.2% | +0.4% | -0.1% |
| 2026 | +2.9% | +3.3% | +1.5% |

### 3. Summary & Observations
- **Cross-Asset Diversification**: Spreading capital across 6 major crypto assets dampens individual asset drawdowns while participating in major structural trends.
- **Notional Exposure Cap**: Aggregate entry notional across open positions is strictly bounded at ≤ 30% of current equity at every entry moment.
- **Circuit Brake Mechanics**: Trips at portfolio drawdown ≥ 10% from peak. Automatically resumes when 30 calendar days elapse or when drawdown recovers to ≤ 5%, rebasing peak equity to current equity upon resumption.
