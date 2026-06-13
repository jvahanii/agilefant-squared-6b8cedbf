## Root cause
Search and the backlog view disagree about snoozed items:
- `searchResults` (WorkItemTreePanel.tsx:2044) returns matches with **no snooze filter**, showing the item with its backlog label.
- The backlog view's `displayedRootItems` (line 2259) explicitly **removes** snoozed items: `.filter((wi) => !snoozedItemIds.has(wi.id))`.
- A small "snoozed N" badge exists in the header (line 2525) but is easy to miss.

Result: user finds "keywi backlog hehkutus" in search, sees its backlog, navigates there, and the item is gone with no obvious explanation.

## Fix
Make snoozed items discoverable from the backlog view, and make search self-explanatory when an item is hidden because it's snoozed.

1. **Search result row**: show a small `BellOff` icon next to snoozed items in the search results (purely visual — the icon is already imported and used in the context menu, so this is just rendering it inline in the row when `isSnoozed` is true).
2. **Clicking a snoozed search result**: in the existing `onNavigate` handler (line 2633), when the target item is snoozed, also call `unsnooze(wi.id)` so it becomes visible in the destination backlog. This matches the user's intent ("show me this item").
3. **Backlog header snoozed badge**: keep existing single-click "unsnooze all" behavior but improve the tooltip and make the badge slightly more prominent (small label "Snoozed: N" instead of just an icon + number) so users notice it.

No data-model changes. All edits in `src/components/WorkItemTreePanel.tsx`.

## Out of scope
- Bug B (child items hidden when their parent is in the same backlog) — `onNavigate` already auto-expands ancestors, so clicking the search result works; manual backlog navigation showing flat children is a separate, larger UX change. Will not touch unless you ask.
- Multi-tree label disambiguation in search results.