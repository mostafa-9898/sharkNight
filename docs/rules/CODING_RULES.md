# Coding Rules & Lessons Learned

This document tracks coding decisions, patterns that worked well, and mistakes to avoid.
Every time we learn something new or find a better approach, it gets documented here.

---

## 📐 Code Standards

### General
- TypeScript strict mode is always ON
- **Zero Errors & Zero Warnings Rule:** After EVERY single change or file addition, the code MUST be verified (`npx tsc --noEmit`, linter, and tests) to ensure 0 errors and 0 warnings.
- Always use `import type` for type-only imports (complies with `isolatedModules`).
- Never write duplicate import statements from the same module; always consolidate imports.
- Every module has an `index.ts` for clean re-exports
- Every component must have corresponding tests
- Functions should be pure when possible (no side effects)
- Use descriptive variable names, no abbreviations

### Naming Conventions
- Files: `kebab-case.ts` (e.g., `sma-crossover.ts`)
- Interfaces: `PascalCase` (e.g., `TradeSignal`)
- Functions: `camelCase` (e.g., `calculateSMA`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_FEE_PERCENT`)
- Test files: `<module-name>.test.ts`

### Testing
- Test file structure mirrors `src/` structure
- Use descriptive test names: `it('should return SELL signal when fast MA crosses below slow MA')`
- Test edge cases: empty arrays, single element, insufficient data
- Use fixed test data (no random values in tests)

---

## ✅ What Worked Well

| Date | Topic | What Worked | Why |
|------|-------|-------------|-----|
| 2026-10-04 | Project Setup | Strict TypeScript config with path aliases | Clean imports, catches bugs early |
| 2026-10-10 | Data Provider DI | Injectable `fetchFn` in provider constructor | Allows 100% offline, deterministic unit tests without network mocking libraries |
| 2026-10-10 | Storage Merging | Map-based deduplication on timestamp | Prevents duplicate candles when appending overlapping time ranges |
| 2026-10-10 | Indicator Design | Dual-layer API: pure functional math (`calculateSMA`) + pluggable classes (`SMAIndicator`) | Provides maximum flexibility for backtesting engine while remaining easily testable |
| 2026-10-10 | Strategy Performance | Local window calculation (`slowPeriod + 1` lookback) in `analyze()` | Prevents $O(N^2)$ scaling during backtesting by only computing required points for crossover |
| 2026-10-10 | Backtest Realization | Synthetic position auto-close at final candle | Ensures all open positions are marked-to-market/realized at backtest conclusion |
| 2026-10-10 | Regional Connectivity | Multi-provider fallback chain (Binance -> KuCoin) | Seamlessly handles geo-blocked API endpoints without breaking user workflow |
| 2026-10-10 | Charting Integration | Dynamic import of browser-only canvas charting inside `useEffect` | Prevents SSR hydration mismatches and commonjs/esm bundling issues |

## ❌ What Didn't Work / Mistakes

| Date | Topic | What Went Wrong | Better Approach |
|------|-------|----------------|----------------|
| 2026-10-04 | Jest + TS config | `jest.config.ts` needs `ts-node` package which wasn't in initial deps | Always include `ts-node` when using `.ts` config files for Jest |
| 2026-10-04 | ts-jest + NodeNext | ts-jest warns about hybrid module kind without `isolatedModules` | Set `isolatedModules: true` in tsconfig.json when using NodeNext module |
| 2026-10-04 | IDE Type Resolution | IDE red squiggly lines on Jest globals (`describe`, `it`, `expect`) | Include `"types": ["node", "jest"]` in `tsconfig.json` compilerOptions |
| 2026-10-04 | Type Imports | Separate duplicate imports for types caused lint warnings | Consolidate imports and use `import type` syntax |
| 2026-10-10 | Destructuring Lint | `const { candles: _unused, ...rest } = config` triggered unused-vars warning | Build subset object explicitly without creating unused destructured bindings |
| 2026-10-10 | NodeNext Module Bundling | NodeNext module resolution clashed with Next.js path aliases | Use `"module": "ESNext"` and `"moduleResolution": "bundler"` for Next.js apps |

## 💡 Patterns & Best Practices

| Pattern | Description | Example |
|---------|-------------|--------|
| Interface-first design | Define interfaces before implementation | `Indicator`, `Strategy`, `DataProvider` |
| Plugin architecture | Strategies and indicators are pluggable | Implement `Strategy` interface for any new strategy |

---

> This is a living document. Update it whenever you learn something new.
