## Goal

In the Savings & Income dialog, when the user changes the entry currency dropdown, convert all currently entered month values (and the year-total draft inputs) from the previous currency to the newly selected currency using today's FX rate.

## Change

**`src/components/FinancialsDialog.tsx`** only — purely presentational, no schema or store changes.

1. Replace the plain `setCurrency` handler with a `handleCurrencyChange(next)` that:
   - Reads current rates via `useRatesStore` and `convertCurrency` from `src/store/ratesStore.ts`.
   - Maps over `savings` and `income` state, converting each month value from the old `currency` to `next`, rounding to 2 decimals, and writes the converted maps back.
   - Also converts any in-progress `yearTotalDraft.savings` / `yearTotalDraft.income` strings if they parse as a number.
   - Finally calls `setCurrency(next)`.
2. Wire the `<Select onValueChange={handleCurrencyChange}>` to the new handler.
3. If rates are not yet loaded (`rates[from]` or `rates[to]` missing), fall back to identity conversion (already the behavior of `convertCurrency`) so values are simply relabeled — same as today.

No changes to totals/chart code (already converts), no DB migration, no changes to how amounts are persisted on Save (they save in the currently selected currency, which is now the converted one).

## Edge cases

- Save semantics unchanged: amounts persist in whatever currency is shown in the picker at Save time.
- Switching back and forth introduces tiny rounding drift (2-decimal). Acceptable for display-grade conversion.
- Empty cells stay empty.
