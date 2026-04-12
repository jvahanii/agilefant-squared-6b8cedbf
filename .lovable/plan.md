

## Plan: Add Enterprise plan + fix build error

### 1. Fix build error in `src/components/AppLayout.tsx`

Line 352 uses `a.rank - b.rank` but the `WorkItem` type now has `ranks` (a `Record<string, number>`) instead of `rank`. Since this sorting happens in the context of a specific backlog (the `backlogId` variable is available in scope), change the sort to use the per-backlog rank:

```ts
.sort((a, b) => (a.ranks[backlogId] ?? 0) - (b.ranks[backlogId] ?? 0));
```

Need to verify `backlogId` is in scope at that point — it should be since this is inside the keyboard reorder handler that already references `treeId` and `backlogIds`.

### 2. Add Enterprise plan to `src/hooks/useSubscription.ts`

Add an `enterprise` entry to the `PLANS` object:
```ts
enterprise: {
  name: "Enterprise",
  price: "Custom",
  product_id: null,
  price_id: null,
  features: ["Dedicated support and organization design advice"],
},
```

### 3. Update `src/components/PricingCards.tsx`

- Add `"enterprise"` to the `planKeys` array.
- Widen grid to 3 columns: `sm:grid-cols-3`, `max-w-2xl`.
- For the enterprise card button: render a "Contact Us" button that opens a mailto link (e.g. `mailto:sales@agilefant.org`) instead of calling `startCheckout`. No special handling needed — it's just a link.

### 4. Update `src/pages/Auth.tsx` — `PlanChoosingDialog`

- Add `"enterprise"` to the `planKeys` array in the dialog.
- Widen grid to 3 columns.
- The enterprise card should behave identically to the other plans — clicking it calls `onPlanChosen("enterprise")`, which stores `"enterprise"` as `pendingPlan` in localStorage, proceeds with signup, and the Onboarding page auto-creates the org. The Onboarding logic already skips checkout for plans without a `price_id`, so no changes needed there.
- After org creation completes for enterprise, open a mailto link so the user can contact sales.

### 5. Update Onboarding flow for enterprise (`src/pages/Onboarding.tsx`)

After org creation, if `pendingPlan === "enterprise"`, open a mailto link (e.g. `window.open("mailto:sales@agilefant.org?subject=Enterprise inquiry")`) and show a toast informing the user that the team will be in touch.

### Summary of files changed
- `src/hooks/useSubscription.ts` — add enterprise plan
- `src/components/PricingCards.tsx` — add enterprise card with mailto CTA
- `src/pages/Auth.tsx` — add enterprise to plan chooser dialog
- `src/pages/Onboarding.tsx` — handle enterprise pendingPlan with mailto
- `src/components/AppLayout.tsx` — fix `.rank` → `.ranks[backlogId]` build error

