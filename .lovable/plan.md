# Savings & Income (Labs)

A new opt-in Labs feature that lets users attach **monthly savings** and **monthly income** amounts to any work item, then visualize them as **cumulative flow diagrams** per backlog tree, sliced by work-item status.

## 1. Labs toggle

In `src/pages/TeamSettings.tsx` (Labs section), add a new card:

- **Savings & Income** switch — default **off**, persisted in `organization_settings.savings_income_enabled`.
- Same pattern as the existing Labels toggle (optimistic update + Supabase upsert + realtime sync).
- New selector `isSavingsIncomeEnabled(orgId)` in `src/store/orgSettingsStore.ts`.

## 2. Database

Migration adds:

- `organization_settings.savings_income_enabled boolean not null default false`
- New table `public.work_item_financials`:
  - `work_item_id text` (PK with org), `organization_id uuid`, `monthly_savings numeric(14,2) default 0`, `monthly_income numeric(14,2) default 0`, `currency text default 'EUR'`, `updated_at`.
  - GRANTs to `authenticated` + `service_role`; RLS mirrors `work_items` (org member OR `has_accessible_tree_assignment` via lookup on the parent work item — simplest: org member OR `is_work_item_accessible`).

## 3. Store

New `src/store/financialsStore.ts` (Zustand) keyed by `workItemId`:
- `load(orgId)`, `upsert(workItemId, { monthlySavings, monthlyIncome, currency })`, `getFor(workItemId)`, realtime apply.
- Loaded inside `supabaseSync` alongside other per-org tables, guarded by the toggle.

## 4. Dialog

New `src/components/FinancialsDialog.tsx`:
- Triggered from a small **€** icon button in the work-item attributes area (`MobileAttributesSheet` + desktop equivalent in `WorkItemTreePanel`), shown only when the toggle is on.
- Fields: Monthly savings, Monthly income, Currency (EUR/USD/GBP). Zod-validated, non-negative numbers, max 12 chars.
- Save = optimistic upsert.

## 5. Cumulative flow diagram

New `src/components/CumulativeFlowChart.tsx` using `recharts` (already in deps):
- One stacked area chart per backlog tree, X axis = month, Y axis = cumulative € of the selected metric (savings or income), areas stacked by **work item status** (using the tree's statuses + colors).
- Data model: for each work item in the tree with a non-zero monthly amount, accrue `amount` for every month from its **creation month** to **now** (or to the month the status changed, snapshotted as "current status"). Since we don't track status history, slice by *current* status of each contributing item — explicitly noted in a chart caption.
- Toggle inside the chart card: Savings | Income.

Rendered in a new collapsible section at the bottom of each `BacklogTreePanel`, **only when** the Labs toggle is on and at least one item in the tree has financial data.

## 6. Scope guards

- All UI gated on `isSavingsIncomeEnabled(activeOrgId)`.
- No realtime / store loads when disabled (keeps the cold-start cost at zero for everyone else).
- Per project memory: pink theme, semantic tokens only, no custom colors in components.

## Technical notes

- `numeric` returned as string by PostgREST — parse with `Number()` at the store boundary.
- Chart slice colors come from `treeStatusesStore` (falls back to default status palette) so it stays consistent with the rest of the app.
- Currency is informational only; no FX conversion.
- Out of scope: historical status transitions, multi-currency aggregation, editing past months individually.

After you approve I will run the migration first, then ship the code in one pass.
