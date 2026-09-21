# Job import picker: reorder and recolor the action buttons

## What changes (in `src/components/SavedSearchPicker.tsx`)

Button row becomes, in order:

1. **"Import selected & auto-place"** — renamed from "Import & auto-place". Red (destructive variant). Stays disabled until both auto-place lists are chosen. First of the three action buttons.
2. **"Import selected"** — gray (secondary variant instead of default).
3. **"Do not import anything, mark N emails read"** — gray (secondary variant), but turns red (destructive) when there are no new jobs to import, i.e. no rows are ticked. Keeps its existing disabled state and tooltip.
4. "Cancel" — unchanged (ghost).

"No new jobs" means nothing is ticked: the count of selected rows is 0. Rows that start unticked (already imported, closed, past deadline, repeats) plus any the user unticked all count as not new.

## Verification

- Typecheck (`bunx tsgo -p tsconfig.app.json --noEmit`).
- Update `src/test/savedSearchPicker.test.tsx` if any assertions reference the old button label or order; run the picker test file.
- Screenshot the dialog in the preview to confirm order and colors (red / gray / red-when-empty).
