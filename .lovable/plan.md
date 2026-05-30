# Multi-currency support for Financials

Today each work item's financials entry has a `currency` field, but amounts are never converted — switching the currency in the dialog just relabels the same number. This plan introduces real conversion using daily exchange rates.

## Concept

- **Entry currency** (per work item, stored): the currency the user typed the numbers in. Stored as-is, never mutated.
- **Display currency** (per viewer, local): the currency totals/charts/badges are shown in. Defaults to EUR, persisted in `localStorage`, switchable from the chart header and the dialog header.
- All sums (item totals, list totals, tree totals, chart series, target line) are converted on the fly to the display currency.

This means: enter 30 EUR for an item, switch display to NOK, and you'll see ~345 NOK everywhere — without rewriting the stored 30.

## Data source

Use **Frankfurter** (`https://api.frankfurter.dev/v1/latest?base=EUR`) — free, no API key, ECB daily rates, ~30 currencies including all in our `CURRENCIES` list. Fetched once per day, cached in `localStorage` with the date stamp. If offline / fetch fails, fall back to the last cached rates; if none, fall back to 1:1 with a small "rates unavailable" indicator.

## Files

**New `src/store/ratesStore.ts`** (Zustand):
- State: `base: 'EUR'`, `rates: Record<string, number>`, `fetchedOn: string` (YYYY-MM-DD), `loading`, `error`.
- `load()` — reads cache from `localStorage` key `fx-rates-v1`; if stale (different UTC day) or missing, fetches Frankfurter and persists.
- `convert(amount, from, to)` — pure helper: `amount * rates[to] / rates[from]`. EUR == base. Returns `amount` unchanged when `from === to` or rates missing.

**New `src/store/displayCurrencyStore.ts`** (Zustand, tiny):
- `displayCurrency: string` persisted in `localStorage` (`display-currency-v1`), default `EUR`.
- `setDisplayCurrency(c)`.

**`src/pages/Index.tsx`**: call `useRatesStore.getState().load()` on mount alongside existing loads.

**`src/hooks/useFinancialTotals.ts`**: convert each entry's monthly sums from its `entry.currency` to the active display currency before aggregating. Return `{ savings, income, currency: displayCurrency, hasData }`. Drop the "most common currency" heuristic.

**`src/components/FinancialTotalsBadge.tsx`**: unchanged API, but now always receives display currency.

**`src/components/FinancialsDialog.tsx`**:
- The currency picker keeps its meaning as **entry currency** for this item (relabel the field "Entry currency").
- Add a separate small "Display: <CUR>" readout in the header showing the converted year total next to the entry total, so the user can sanity-check conversion. Cells remain editable in entry currency.
- No data migration needed.

**`src/components/CumulativeFlowChart.tsx`**:
- Add a display-currency `Select` next to the metric toggle (bound to `displayCurrencyStore`).
- When building `savingsByMonth` / `incomeByMonth`, convert each contributing entry's monthly value from its entry currency to display currency.
- Targets: store unchanged (still in their saved currency, which we'll continue to treat as the tree's "target currency" = display currency at the time of save). When rendering the reference line, convert target amount → display currency. The target dialog edits in the current display currency and saves with that currency tag.

**Tests**: add a small unit test for `ratesStore.convert` (EUR↔USD↔NOK round-trip with mocked rates) and update existing financial-total tests if they assert currency strings.

## Technical details

```text
ratesStore (Zustand)
  ├─ load(): cache key fx-rates-v1 = { base, rates, fetchedOn }
  │     fetch https://api.frankfurter.dev/v1/latest?base=EUR  (once / UTC day)
  └─ convert(amount, from, to): amount * rates[to] / rates[from]

useFinancialTotals(itemIds)
  for each entry:
    sumSavings += convert(sumMap(entry.savingsByMonth), entry.currency, display)
    sumIncome  += convert(sumMap(entry.incomeByMonth),  entry.currency, display)

CumulativeFlowChart
  per month, per item: convert(value, entry.currency, display)
  target line: convert(target.amount, target.currency, display)
```

Error/edge handling:
- Unknown currency code → treat as identity (no conversion), log once.
- Rates not yet loaded on first render → show values as-is with a subtle "converting…" hint; re-render after `load()` resolves.
- No network on first ever load and no cache → 1:1 conversion + tiny warning icon in the chart/dialog header.

## Out of scope

- Per-month historical FX rates (we use latest daily rates for all months — good enough for the stated "previous day is fine").
- Letting users pick a different FX provider or pin a rate.
- Server-side caching (purely client-side; the Frankfurter API is unauthenticated and CORS-enabled).
