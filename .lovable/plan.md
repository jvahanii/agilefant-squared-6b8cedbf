## Goal

Split each work item's financial entry into **Plan** (existing) and **Actual** (new). Actual is editable only for past months (current month = future). Actual rows in the dialog start pre-populated from the plan. The chart shows both as overlaid series with future portions visually muted.

## Data model

Add two jsonb columns to `work_item_financials`:

- `actual_savings_by_month jsonb NOT NULL DEFAULT '{}'`
- `actual_income_by_month jsonb NOT NULL DEFAULT '{}'`

No backfill — existing rows get empty actuals. No RLS / grants change (table policies already cover all columns).

## Store: `src/store/financialsStore.ts`

- Extend `WorkItemFinancials` with `actualSavingsByMonth` and `actualIncomeByMonth` (both `MonthlyMap`).
- `rowToEntry` reads the two new columns via `sanitizeMap`.
- `upsert` accepts the two new maps and writes them to the new columns.
- `applyRealtime` already routes through `rowToEntry`, no extra change.

## "Past month" helper

Add a tiny helper `isPastMonth(year, monthIndex0)` returning true only when the month strictly precedes the current calendar month (UTC). Current month is treated as future per user choice.

## Dialog: `src/components/FinancialsDialog.tsx`

Change the table from 2 rows (Savings, Income) to 4 rows:

```text
Savings · Plan       [Jan..Dec inputs]   [Year]   [Total]
Savings · Actual     [Jan..Dec inputs]   [Year]   [Total]
Income  · Plan       [Jan..Dec inputs]   [Year]   [Total]
Income  · Actual     [Jan..Dec inputs]   [Year]   [Total]
```

State: `savingsPlan`, `savingsActual`, `incomePlan`, `incomeActual` maps. On open, actual maps default to a shallow copy of plan maps when the saved actual map is empty for that year; otherwise use saved actual as-is.

Behavior:
- Future-month cells in the Actual rows are rendered as disabled inputs with muted styling and a tooltip ("Future month — edit the plan").
- Past-month cells in the Actual row remain editable. If left blank, treat as "no actual yet" (stored as missing key, not 0).
- The year-total distribute input on Actual rows distributes only across past months of the selected year; if the year is fully in the future, the input is disabled.
- Currency conversion on currency-change applies to all four maps (extend the existing `handleCurrencyChange`).
- Save persists all four maps. Clear-all wipes all four.

Totals shown per row use `sumMap` over the respective map (already correct after split).

## Aggregated totals: `src/hooks/useFinancialTotals.ts`

Add an "effective" sum per metric per entry: for each year present in the maps, take **actual** for past months and **plan** for the current+future months, then sum. Reuse this in `rollup` so badges and lists naturally reflect the realized + planned mix. This is computed per entry to keep currency conversion correct.

## Chart: `src/components/CumulativeFlowChart.tsx`

Render two overlaid cumulative series per metric:

- **Plan** — full 12 months, drawn with the existing color but reduced opacity (e.g. `fillOpacity 0.15`, dashed stroke `strokeDasharray="4 4"`).
- **Actual** — only past months populated; current and future months as `null` so Recharts breaks the line. Solid stroke, normal opacity.

For grouping modes:
- `groupBy === "type"`: emit four series — `savingsPlan`, `savingsActual`, `incomePlan`, `incomeActual` — using existing green/blue palette (savings = green, income = blue), actual solid, plan dashed/translucent.
- Other groupings (`item`, `status`, `list`): keep one series per group but switch the data source so past months come from actual (falling back to plan when actual missing) and future months come from plan. Add a vertical `ReferenceLine` at the boundary between the last past month and the current month with label "today" so the user can see the realized/plan transition.
- Add a vertical `ReferenceLine` at the today boundary in `type` mode as well.

Tooltip and legend automatically reflect the new series via existing series map.

`sumMaps` helper unchanged; new helper `accruedThroughMonth(map, year, mk)` already inlined will be reused.

## Out of scope

- Per-month FX rates (still uses today's rate as before).
- No change to targets, share/RLS, or change log.
