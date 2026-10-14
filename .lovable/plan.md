# Fix: cannot set a deadline for a selected item on mobile

## What we know

- Deadlines are an organization-level switch (Bells & Whistles → Deadlines), and it is **on** for the Agilefant organization, which owns both the JARNO and Työpaikkalistaukset trees. So the switch is not the blocker.
- Two mobile paths should offer a deadline, and both exist in code:
  - the long-press context menu on an item row has "Set deadline…" (`WorkItemTreePanel.tsx`, gated on the org switch)
  - the mobile attributes sheet has a Deadline date field (`MobileAttributesSheet.tsx`, same gate)
- Since the user still can't set one, the failure is in how these paths behave on a phone: either the long-press menu never opens (drag/scroll gestures intercept it), or the sheet's Deadline row is not reached (below the fold in the 80vh sheet, or the sheet isn't what opens for a selected item).

## Plan

1. **Reproduce** with Playwright at a phone viewport against the preview: open the JARNO tree, select an item, then try both paths — long-press the row, and open the attributes sheet — capturing screenshots and console errors to see exactly where the deadline action is missing or unreachable.
2. **Fix the failing path**, whichever it turns out to be:
   - If the long-press menu doesn't open on mobile: make the item's mobile actions (the button that opens the attributes sheet) the reliable entry point, and ensure the sheet is complete.
   - If the sheet's Deadline row is missing or buried: ensure it renders for the selected item and is visible without hunting (move date fields up, or section the sheet).
   - If the deadline dialog opens but can't save on mobile: fix that interaction.
3. **Regression test**: add/extend a mobile-viewport test covering "open item actions on mobile → set a deadline → it saves", alongside the existing `mobileCreatedDate.test.tsx` pattern.
4. Verify the fix on the preview at a phone viewport before reporting back.
