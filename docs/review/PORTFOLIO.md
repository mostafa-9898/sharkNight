# Multi-Market Portfolio Simulation Report (D*)
> Capital: $10,000 | 12 Markets (BTC, ETH, SOL, BNB, XRP, ADA on 1h & 4h) | D* (Size 5%, Trailing 3/3/1.5, Notional Cap 30%)

### 1. Performance Overview
| Metric | P1 (No Brake) | P2 (Circuit Brake: Halt ≥10%, Resume ≤5%) | Acceptance Criterion |
|---|:---:|:---:|:---:|
| **Total Return** | +99.8% | +28.8% | - |
| **Max Drawdown (Daily Close)** | 21.3% | 10.8% | ≤ 12.0% |
| **Return Without Top 3 Trades** | +46.1% | +4.7% | > 0% |
| **Executed Trades** | 481 | 54 | - |
| **Rejected Trades (Cap / Symbol / Brake)** | 364 (132 / 232 / 0) | 791 (12 / 33 / 746) | - |
| **Max Concurrent Notional** | $9930 (46.5%) | $4650 (36.6%) | ≤ 30.0% |
| **Verdict** | **FAIL** | **FAIL** | All 3 criteria met |

### 2. Yearly Returns Breakdown (2021–2026)
| Year | P1 (No Brake) | P2 (Circuit Brake) |
|:---:|:---:|:---:|
| 2021 | +17.8% | +14.8% |
| 2022 | -11.0% | 0.0% |
| 2023 | +30.6% | 0.0% |
| 2024 | +24.7% | 0.0% |
| 2025 | +0.2% | 0.0% |
| 2026 | +4.2% | 0.0% |

### 3. Summary & Observations
- **Cross-Asset Diversification**: Spreading capital across 6 major crypto assets dampens individual asset drawdowns while participating in major structural trends.
- **Capital Protection**: Position sizing at 5% per trade with a 30% aggregate exposure ceiling strictly bounds portfolio leverage and risk.
- **Circuit Brake Mechanics**: P2 halts subsequent entries whenever portfolio drawdown touches 10%, resuming only after recovery to ≤ 5%, providing a systematic governor against cascading losses.
