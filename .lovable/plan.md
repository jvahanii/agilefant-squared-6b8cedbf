## Goal

Expose the existing **Move to backlog dialog** (already bound to the `M` keyboard shortcut) as a first-class command in the work item context menu, on both desktop and mobile.

## Current state

- Desktop right-click menu (`WorkItemTreePanel.tsx`, ~lines 1089–1117) only shows an inline **"Move to backlog ▸"** submenu listing every backlog. There is no single command that opens the full `MoveToBacklogDialog` (which supports search, multi-select context, and tree-aware target picking).
- Mobile attribute sheet (`MobileAttributesSheet.tsx`) already has a **"Move to backlog → Move"** row wired to `openMoveToBacklogDialog`.
- The `M` shortcut (`shortcut:move-to-backlog`) already opens that dialog for the selected item(s).

## Changes

### Desktop — `src/components/WorkItemTreePanel.tsx`
Add a new `ContextMenuItem` **"Move…"** just above the existing "Move to backlog" submenu:

- `onSelect` → `openMoveToBacklogDialog()` (already defined at line 377)
- Right-aligned `⌘`-style shortcut hint showing `M` (using a small `<span className="ml-auto text-[10px] text-muted-foreground">M</span>`, matching the visual pattern of other hinted items in this menu — or `ContextMenuShortcut` if available)
- Keep the existing inline submenu of backlogs as a quick-pick shortcut (it's useful and doesn't conflict)

### Mobile — `src/components/MobileAttributesSheet.tsx`
The "Move to backlog" row already calls `onOpenMove`. Light tweak:
- Rename the row label from "Move to backlog" / "Move" to **"Move…"** with the same `FolderInput` icon, for parity with desktop terminology.

## Out of scope

- No changes to the shortcut binding, the dialog itself, or the inline backlog submenu logic.
- No business-logic changes.
