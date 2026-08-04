# Fix the list slowdown in the work item panel

## What's happening

The last "make list views faster" change (commit `b1797161`) added a shared React context (`SharedDataContext`) so rows could stop subscribing to stores individually. But the value handed to that provider is rebuilt as a brand-new object on **every** panel render:

```tsx
const sharedData: SharedData = { orgLabels, teams, labelsVisible, ... };  // not memoized
<SharedDataContext.Provider value={sharedData}>
```

Because the context value's identity changes each render, `React.memo` on `WorkItemNode` is bypassed and **every row in the list re-renders on every panel render**. The search box makes this constant: `searchQuery` lives in the global app store (`WorkItemTreePanel.tsx:2224`), so each keystroke re-renders the panel, which re-renders all ~50+ rows — each row being a heavy component (context menus, status lists, label memos, dialogs).

Two smaller amplifiers are still in the row component:

- `WorkItemTreePanel.tsx:252-253` — each row subscribes to the whole `workItems` and `backlogs` maps, so any single item mutation re-renders every row.
- `WorkItemTreePanel.tsx:309-320` — each row subscribes twice to the full `statusesByBacklog` map (once as a bare subscription, once inside `useMemo` deps).

## The fix

1. **Memoize the shared context value** with `useMemo` over its actual dependencies, so the provider value only changes when one of the shared values changes. This alone restores `memo()` on all rows and stops the per-keystroke full-list re-render.
2. **Drop the row-level whole-map subscriptions.** Replace `const workItems = useAppStore(s => s.workItems)` / `backlogs` in `WorkItemNodeContent` with either narrow selectors for the specific values the row needs (children ids, sibling ranks, assignment lookups) or `useAppStore.getState()` reads inside the event handlers that use them.
3. **Narrow the statuses subscription** to `statusesByBacklog[backlogId]` only, and use that value as the `useMemo` dependency instead of the whole map.
4. **Keep search input responsive**: hold the input's text in local component state and push it into the store debounced (or only past the 3-character search threshold), so typing does not re-render the tree at all.

## Verification

- Confirm the list re-renders only when its own data changes: type in the search box with a 50+ item list open and check that typing stays smooth.
- Run the existing test suite (`appStore`, `paginationGuard`) to make sure store access changes didn't break behavior.

## Notes

No database, RLS, or backend changes — this is entirely render/subscription work inside `src/components/WorkItemTreePanel.tsx`.
