## Goal

Add a second chart mode to the financials section: a **monthly stacked bar chart** showing Plan and Actual values per month. Side-by-side with the existing cumulative area chart, toggled via a chart-type switch. Reuses the existing year navigation, currency, metric, and groupBy controls.

## Behavior

- **X axis**: 12 months of the selected year (Jan…Dec), same as today.
- **Y axis**: monthly amount (not cumulative) in display currency.
- **Bars per month**: two adjacent bars — **Plan** and **Actual** — each a stack split by the current `groupBy` (type / item / status / list).
- **Future months**: the Actual bar is rendered with reduced opacity (or omitted) for current+future months, mirroring how the area chart breaks the actual line. Plan bar is full opacity for all months.
- **Tooltip**: per month, lists each series and its Plan / Actual values; total at the bottom.
- **Legend**: same series colors as the area chart. A small "Plan / Actual" indicator (e.g. solid vs hatched/translucent) explains the bar pair.
- **Today reference**: a vertical `ReferenceLine` between the last past month and the current month, label "today" — same as the area chart.
- **Target line**: optional horizontal `ReferenceLine` only when `groupBy === "type"` and a target exists, drawn as **monthly target = annual / 12** so it stays meaningful on a non-cumulative chart. Otherwise hidden.

## Chart-type toggle

Add a small segmented control in the existing chart header (next to the year/currency controls):

```text
[ Cumulative ]  [ Monthly bars ]
```

State `chartType: "area" | "bar"` lives in `CumulativeFlowChart` (the component stays the single entry point, just renders one of two chart bodies). Persist the choice in `localStorage` under `financials-chart-type-v1`.

The header readout updates: "Cumulative …" stays for the area mode; bar mode reads "Monthly … · {year}" with the same total (sum of plan for the year).

## Data shape for the bar chart

Build a per-month row similar to today, but **non-cumulative**:

```ts
{
  month: "2026-01", label: "Jan",
  [`${seriesKey}_plan`]: number,    // 0 if no entry
  [`${seriesKey}_actual`]: number | null,  // null for current+future months
}
```

For `groupBy === "type"`, series are `savings` and `income` (same colors). For other groupings, one series per status / item / backlog (same color logic as today).

Reuse the existing helpers: `treeItemIds`, `getPlanMap`, `getActualMap`, `series` memo, `convertCurrency`, `isPastMonth`. Only the data-building loop changes (sum the single month, not the accrued total).

## Rendering

Use Recharts `BarChart` with two `<Bar>` per series:

```tsx
<Bar dataKey={`${s.key}_plan`}   stackId="plan"   fill={s.color} fillOpacity={0.85} />
<Bar dataKey={`${s.key}_actual`} stackId="actual" fill={s.color} fillOpacity={1} stroke={s.color} />
```

`barCategoryGap` set so the Plan/Actual pair sits adjacent within each month slot. Future-month Actual cells are `null`, so they render as empty space inside the Actual stack — visually distinct from the populated Plan stack next to them.

## Out of scope

- No new data model, store, or migration changes.
- No new groupings or metrics.
- No editing from the chart.
- No animation / transitions beyond Recharts defaults.

## File touched

- `src/components/CumulativeFlowChart.tsx` — add chart-type toggle, new `bar`-mode data memo, and render `BarChart` when selected. Possibly extract two small inner components (`CumulativeAreaBody`, `MonthlyBarBody`) to keep the file readable; leave header/controls shared.
