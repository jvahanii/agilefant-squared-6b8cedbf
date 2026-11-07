/**
 * The keyboard shortcuts of the app, one entry each: how the guide writes it,
 * what it is for, which key presses are it, and what it does.
 *
 * They used to be one 537-line function in AppLayout — an if-chain and then a
 * switch — and the user guide and the ? overlay each kept a list of their own,
 * which drifted from it (the overlay knew nothing of ←, A, Ctrl+D or F2; the
 * guide nothing of A). Now the handler, the guide and the overlay read this.
 *
 * A key press is answered by the first entry that matches it. Those marked
 * `anywhere` answer even while typing in a field or with a dialog open; the
 * rest do not. The entries are written so that no two match the same press,
 * so their order matters only for how the guide lists them.
 */
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { isTimeLoggingEnabled } from "@/store/orgSettingsStore";
import { requestTopLevelRerank } from "@/store/rerankGuardStore";
import { listSortModeFor, shownTopLevelOrder } from "@/store/listSortStore";
import { visibleWorkItemIdsRef, visibleBacklogIdsRef, deleteDirectionRef } from "@/store/navigationRefs";
import { rowAfterStatusMove } from "@/lib/statusSelection";
import { topLevelItems } from "@/lib/workItemRows";
import { getEffectiveParentId, type WorkItemStatus } from "@/types/models";

export type ShortcutGroup =
  | "Navigation"
  | "Creating & Deleting"
  | "Reordering"
  | "Status"
  | "Reparenting & Moving"
  | "Other";

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  "Navigation",
  "Creating & Deleting",
  "Reordering",
  "Status",
  "Reparenting & Moving",
  "Other",
];

export interface ShortcutContext {
  e: KeyboardEvent;
  /** The app's state as the key was pressed. */
  state: ReturnType<typeof useAppStore.getState>;
  /** Was a dialog open as the key went down (see AppLayout: Radix closes one on Escape first). */
  dialogWasOpen: boolean;
  toggleShortcutsOverlay: () => void;
  openTimesheet: () => void;
}

export interface Shortcut {
  id: string;
  group: ShortcutGroup;
  /** As the guide writes it: each list one row, its keys pressed together. */
  rows: Array<{ keys: string[]; description: string }>;
  /** Answers while typing in a field and with a dialog open too. */
  anywhere?: boolean;
  /** Is this key press this shortcut? Absent for one handled elsewhere, listed only. */
  matches?: (e: KeyboardEvent) => boolean;
  run?: (ctx: ShortcutContext) => void;
}

const key = (e: KeyboardEvent) => e.key.toLowerCase();
const withCtrl = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
/** No Ctrl or Cmd: the plain shortcuts. */
const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey;
const dialogOpen = (ctx: ShortcutContext) => ctx.dialogWasOpen || !!document.querySelector('[role="dialog"]');
const send = (name: string, detail?: unknown) =>
  window.dispatchEvent(detail === undefined ? new CustomEvent(name) : new CustomEvent(name, { detail }));

/** Ask the list showing this work item to scroll it into view (WorkItemTreePanel listens). */
export function revealWorkItem(id: string) {
  window.dispatchEvent(new CustomEvent("shortcut:reveal-work-item", { detail: { id } }));
}

/**
 * Scroll the backlog tree to a backlog's row. The tree is not virtualized, so
 * the row is already on the page; one frame lets the selection render first.
 */
export function revealBacklog(id: string) {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-backlog-tree-row="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

/** A list and every list under it, the list first. */
function listAndBelow(state: ShortcutContext["state"], backlogId: string): string[] {
  const backlogIds: string[] = [];
  const collect = (id: string) => {
    backlogIds.push(id);
    state.backlogs[id]?.childrenIds.forEach(collect);
  };
  collect(backlogId);
  return backlogIds;
}

/**
 * Set the status of every selected work item, as one undo step. In a list
 * whose sort the change reorders (sorted by status), the selection then moves
 * to the row below the old spot rather than following the item to its new
 * group — see lib/statusSelection.
 */
function setSelectedStatus({ e, state }: ShortcutContext, status: WorkItemStatus, label: string) {
  if (state.selectedWorkItemIds.length === 0) return;
  e.preventDefault();
  const selectedIds = state.selectedWorkItemIds;
  const backlogId = state.selectedBacklogIds[0];
  const treeId = state.selectedTreeId;
  const mode = listSortModeFor(backlogId);
  const inList = !!backlogId && !!treeId && state.backlogs[backlogId]?.viewMode !== "board" && mode !== "rank";

  // The backlogs the list shows: the selected one and everything under it.
  const shown = new Set<string>();
  const collect = (id: string) => {
    shown.add(id);
    state.backlogs[id]?.childrenIds.forEach(collect);
  };
  if (inList) collect(backlogId);
  const topLevelOrder = (workItems: typeof state.workItems) =>
    shownTopLevelOrder(topLevelItems(workItems, treeId!, shown), mode, treeId!).map((wi) => wi.id);
  const visibleBefore = visibleWorkItemIdsRef.current;
  const orderBefore = inList ? topLevelOrder(state.workItems) : [];

  state.runBulk(() => {
    selectedIds.forEach((id) => state.setWorkItemStatus(id, status));
  });

  if (inList) {
    const after = useAppStore.getState();
    const selected = new Set(selectedIds);
    const next = rowAfterStatusMove({
      visibleBefore,
      selectedIds,
      orderBefore,
      orderAfter: topLevelOrder(after.workItems),
      isInsideSelected: (id) => {
        const seen = new Set<string>();
        for (let p = getEffectiveParentId(after.workItems[id], treeId!); p && !seen.has(p); ) {
          if (selected.has(p)) return true;
          seen.add(p);
          const parent = after.workItems[p];
          p = parent ? getEffectiveParentId(parent, treeId!) : null;
        }
        return false;
      },
    });
    if (next) after.selectWorkItem(next, false);
  }
  toast({ title: `Marked ${selectedIds.length} item(s) as ${label}` });
}

/** Move the selected work items one step up (-1) or down (+1) among their siblings. */
function moveSelectedItems({ state }: ShortcutContext, direction: -1 | 1) {
  if (state.selectedWorkItemIds.length < 1 || !state.selectedTreeId || state.selectedBacklogIds.length === 0) return;
  const anchorId = state.selectedWorkItemIds[0];
  const wi = state.workItems[anchorId];
  if (!wi) return;
  const treeId = state.selectedTreeId;
  const selectedBacklogId = state.selectedBacklogIds[0];
  const selectedSet = new Set(state.selectedWorkItemIds);
  const backlogIds = listAndBelow(state, selectedBacklogId);
  const backlogIdSet = new Set(backlogIds);
  const wiEffectiveParent = getEffectiveParentId(wi, treeId);
  const anchorParentInContext =
    wiEffectiveParent !== null &&
    !!state.workItems[wiEffectiveParent] &&
    backlogIdSet.has(state.workItems[wiEffectiveParent].backlogAssignments[treeId]);

  // Neighbours are found in rank order, so this runs after any save of the
  // shown order: in a list sorted by name, "up" means the item above on
  // screen only once that order has become the rank.
  const move = () => {
    const current = useAppStore.getState().workItems;
    const siblings = Object.values(current)
      .filter((w) => {
        if (!backlogIdSet.has(w.backlogAssignments[treeId])) return false;
        const wEffectiveParent = getEffectiveParentId(w, treeId);
        if (anchorParentInContext) {
          return wEffectiveParent === wiEffectiveParent;
        }
        return (
          wEffectiveParent === null ||
          !current[wEffectiveParent] ||
          !backlogIdSet.has(current[wEffectiveParent].backlogAssignments[treeId])
        );
      })
      .sort((a, b) => {
        const rankDiff = (a.ranks[a.backlogAssignments[treeId]] ?? 0) - (b.ranks[b.backlogAssignments[treeId]] ?? 0);
        return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
      });

    // Find drop-zone indices of all selected siblings; move the whole group by one
    // neighbour up or down — top selected → zone-1 for up, bottom selected → zone+2 for down.
    const selectedIdxs: number[] = [];
    siblings.forEach((s, i) => {
      if (selectedSet.has(s.id)) selectedIdxs.push(i);
    });
    if (selectedIdxs.length === 0) return;
    const topIdx = selectedIdxs[0];
    const botIdx = selectedIdxs[selectedIdxs.length - 1];
    const newIdx = direction === -1 ? topIdx - 1 : botIdx + 2;
    if (newIdx < 0 || newIdx > siblings.length) return;
    useAppStore.getState().reorderWorkItemAmongSiblings(anchorId, newIdx, treeId, backlogIds);
  };

  requestTopLevelRerank({
    treeId,
    backlogId: selectedBacklogId,
    backlogIds,
    touchesTopLevel: !anchorParentInContext,
    proceed: move,
  });
}

/** With no item selected, the selected list moves one step up (-1) or down (+1) among its siblings. */
function moveSelectedList({ state }: ShortcutContext, direction: -1 | 1) {
  const blId = state.selectedBacklogIds[0];
  const bl = state.backlogs[blId];
  if (!bl || !state.selectedTreeId) return;
  const parentId = bl.parentId;
  const siblingIds = parentId
    ? (state.backlogs[parentId]?.childrenIds ?? [])
    : (state.backlogTrees[state.selectedTreeId]?.rootBacklogIds ?? []);
  const currentIdx = siblingIds.indexOf(blId);
  const newIdx = currentIdx + direction;
  if (direction === 1 && newIdx < siblingIds.length) {
    // Move to one position after current → swap with the next sibling
    state.reorderBacklogAmongSiblings(blId, newIdx + 1, parentId, state.selectedTreeId);
  } else if (direction === -1 && newIdx >= 0) {
    state.reorderBacklogAmongSiblings(blId, newIdx, parentId, state.selectedTreeId);
  }
}

/** The selected item, or else list, moves one step: an item if one is selected, otherwise the list. */
function moveSelection(ctx: ShortcutContext, direction: -1 | 1) {
  const { e, state } = ctx;
  if (state.selectedWorkItemIds.length >= 1 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
    e.preventDefault();
    moveSelectedItems(ctx, direction);
  } else if (state.selectedWorkItemIds.length === 0 && state.selectedBacklogIds.length > 0 && state.selectedTreeId) {
    e.preventDefault();
    moveSelectedList(ctx, direction);
  }
}

/**
 * The selected items to the top or the bottom of their siblings.
 *
 * reorderWorkItemAmongSiblings is called once per unique sibling context
 * rather than once per selected item. Each call already moves every selected
 * item in that context (internally it uses itemsToMoveIds =
 * selectedWorkItemIds), so calling it N times for N items in the same group
 * creates N−1 redundant undo entries. Those ghost entries make the user press
 * Ctrl+Z N times to undo a single T press; the first N−1 presses appear to do
 * nothing, hiding the fact that one more Ctrl+Z will silently undo the move. A
 * subsequent drag/reorder then writes the undo'd state back to the DB, causing
 * items to no longer be at the top on the next reload.
 */
function rankSelectionTo({ e, state }: ShortcutContext, end: "top" | "bottom") {
  if (!(state.selectedWorkItemIds.length > 0 && state.selectedTreeId && state.selectedBacklogIds.length > 0)) return;
  e.preventDefault();
  const treeId = state.selectedTreeId;
  const selectedBacklogId = state.selectedBacklogIds[0];
  const backlogIds = listAndBelow(state, selectedBacklogId);
  const backlogIdSet = new Set(backlogIds);
  const contextOf = (id: string) => {
    const wi = state.workItems[id];
    if (!wi) return null;
    const effectiveParentId = getEffectiveParentId(wi, treeId);
    const parentInContext =
      effectiveParentId !== null && backlogIdSet.has(state.workItems[effectiveParentId]?.backlogAssignments[treeId] ?? "");
    return parentInContext ? `child:${effectiveParentId}` : "root";
  };
  requestTopLevelRerank({
    treeId,
    backlogId: selectedBacklogId,
    backlogIds,
    touchesTopLevel: state.selectedWorkItemIds.some((id) => contextOf(id) === "root"),
    proceed: () => {
      const processedContexts = new Set<string>();
      state.runBulk(() => {
        state.selectedWorkItemIds.forEach((id) => {
          const contextKey = contextOf(id);
          if (!contextKey || processedContexts.has(contextKey)) return;
          processedContexts.add(contextKey);
          state.reorderWorkItemAmongSiblings(id, end === "top" ? 0 : 999999, treeId, backlogIds);
        });
      });
      toast({ title: `Moved ${state.selectedWorkItemIds.length} items to ${end}` });
    },
  });
}

/** Open (→) or close (←) the selected item's branch, or else the selected list's. */
function expandOrCollapse({ e, state }: ShortcutContext, open: boolean) {
  if (state.selectedWorkItemIds.length > 0) {
    const wiId = state.selectedWorkItemIds[0];
    const wi = state.workItems[wiId];
    if (wi && wi.childrenIds.length > 0) {
      e.preventDefault();
      if (open) useAppStore.getState().expandWorkItemsRecursive(wiId);
      else useAppStore.getState().collapseWorkItemsRecursive(wiId);
    }
  } else if (state.selectedBacklogIds.length > 0) {
    const backlogId = state.selectedBacklogIds[0];
    const backlog = state.backlogs[backlogId];
    if (backlog && backlog.childrenIds.length > 0) {
      e.preventDefault();
      if (open) useAppStore.getState().expandBacklogsRecursive(backlogId);
      else useAppStore.getState().collapseBacklogsRecursive(backlogId);
    }
  }
}

/** ↑ / ↓ move the selection; with Shift they extend it. Through items if one is selected, else through lists. */
function stepSelection({ e, state }: ShortcutContext) {
  // When the selected backlog is in board view mode, BoardView handles arrow-
  // key navigation within columns. Skip the flat-list based navigation here to
  // avoid double-stepping.
  const selectedBacklogId = state.selectedBacklogIds[0];
  if (selectedBacklogId && state.backlogs[selectedBacklogId]?.viewMode === "board") return;

  const isDown = key(e) === "arrowdown";
  if (state.selectedWorkItemIds.length > 0) {
    const ids = visibleWorkItemIdsRef.current;
    if (e.shiftKey) {
      // Shift+Arrow: extend the selection range by one in the pressed direction.
      const selectedIndices = state.selectedWorkItemIds
        .map((id) => ids.indexOf(id))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);
      if (selectedIndices.length === 0) return;
      const nextIdx = isDown
        ? Math.min(selectedIndices[selectedIndices.length - 1] + 1, ids.length - 1)
        : Math.max(selectedIndices[0] - 1, 0);
      const nextId = ids[nextIdx];
      if (!nextId) return;
      e.preventDefault();
      // Add to selection if not already selected — never remove on extend.
      if (!state.selectedWorkItemIds.includes(nextId)) {
        useAppStore.getState().selectWorkItem(nextId, true);
      }
      revealWorkItem(nextId);
    } else {
      // Plain Arrow: single-select navigation.
      const currentId = state.selectedWorkItemIds[state.selectedWorkItemIds.length - 1];
      const idx = ids.indexOf(currentId);
      if (idx === -1) return;
      const nextIdx = isDown ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= ids.length) return;
      e.preventDefault();
      useAppStore.getState().selectWorkItem(ids[nextIdx]);
      revealWorkItem(ids[nextIdx]);
    }
  } else if (state.selectedBacklogIds.length > 0) {
    // Navigate selection through visible backlogs.
    const currentId = state.selectedBacklogIds[state.selectedBacklogIds.length - 1];
    const ids = visibleBacklogIdsRef.current;
    const idx = ids.indexOf(currentId);
    if (idx === -1) return;
    const nextIdx = isDown ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    const nextBacklog = useAppStore.getState().backlogs[ids[nextIdx]];
    if (!nextBacklog) return;
    e.preventDefault();
    useAppStore.getState().selectBacklog(ids[nextIdx], nextBacklog.treeId);
    revealBacklog(ids[nextIdx]);
  }
}

/** Send an event to whoever opens the dialog, when an item is selected. */
const onSelectedItems = (event: string) => ({ e, state }: ShortcutContext) => {
  if (state.selectedWorkItemIds.length > 0) {
    e.preventDefault();
    send(event);
  }
};

const status = (id: string, letter: string, value: WorkItemStatus, label: string): Shortcut => ({
  id,
  group: "Status",
  rows: [{ keys: [letter.toUpperCase()], description: `Set status: ${label}` }],
  matches: (e) => plain(e) && key(e) === letter,
  run: (ctx) => setSelectedStatus(ctx, value, label),
});

export const SHORTCUTS: Shortcut[] = [
  // ─── Navigation ───────────────────────────────────────────────────────────
  {
    id: "step-selection",
    group: "Navigation",
    rows: [
      { keys: ["↑", "↓"], description: "Move selection up / down" },
      { keys: ["Shift", "↑ / ↓"], description: "Extend the selection up / down" },
    ],
    matches: (e) => plain(e) && (key(e) === "arrowup" || key(e) === "arrowdown"),
    run: stepSelection,
  },
  {
    id: "expand",
    group: "Navigation",
    rows: [{ keys: ["→"], description: "Expand selected item or list branch" }],
    matches: (e) => plain(e) && key(e) === "arrowright",
    run: (ctx) => expandOrCollapse(ctx, true),
  },
  {
    id: "collapse",
    group: "Navigation",
    rows: [{ keys: ["←"], description: "Collapse selected item or list branch" }],
    matches: (e) => plain(e) && key(e) === "arrowleft",
    run: (ctx) => expandOrCollapse(ctx, false),
  },
  {
    id: "deselect",
    group: "Navigation",
    rows: [{ keys: ["Esc"], description: "Deselect all items" }],
    matches: (e) => plain(e) && key(e) === "escape",
    run: ({ state }) => {
      if (state.selectedWorkItemIds.length > 0) useAppStore.getState().clearWorkItemSelection();
    },
  },
  {
    id: "select-range",
    group: "Navigation",
    rows: [{ keys: ["Shift", "Click"], description: "Select a range of items" }],
  },
  {
    id: "select-all",
    group: "Navigation",
    anywhere: true,
    rows: [{ keys: ["Ctrl", "A"], description: "Select all visible work items" }],
    matches: (e) => withCtrl(e) && key(e) === "a",
    run: (ctx) => {
      // In a field, Ctrl+A selects its text, as everywhere else.
      if (typingIn(ctx.e) || dialogOpen(ctx)) return;
      const ids = visibleWorkItemIdsRef.current;
      if (ids.length > 0) {
        ctx.e.preventDefault();
        useAppStore.setState({ selectedWorkItemIds: [...ids] });
      }
    },
  },

  // ─── Creating & Deleting ──────────────────────────────────────────────────
  {
    id: "new",
    group: "Creating & Deleting",
    rows: [{ keys: ["Enter"], description: "New item: below the selected one, or in the selected list" }],
    matches: (e) => plain(e) && !e.altKey && !e.shiftKey && key(e) === "enter",
    run: ({ e, state }) => {
      e.preventDefault();
      if (state.selectedWorkItemIds.length > 0) send("shortcut:add-sibling-workitem");
      else if (state.selectedBacklogIds.length > 0 && state.selectedTreeId) send("shortcut:add-workitem");
    },
  },
  {
    id: "new-child",
    group: "Creating & Deleting",
    rows: [{ keys: ["Shift", "Enter"], description: "New child under the selected item or list" }],
    matches: (e) => plain(e) && !e.altKey && e.shiftKey && key(e) === "enter",
    run: ({ e, state }) => {
      e.preventDefault();
      if (state.selectedWorkItemIds.length > 0) send("shortcut:add-child-workitem");
      else if (state.selectedBacklogIds.length > 0) send("shortcut:add-child-backlog");
    },
  },
  {
    id: "delete",
    group: "Creating & Deleting",
    rows: [{ keys: ["Del / Bksp"], description: "Delete selected item(s) or list" }],
    matches: (e) => plain(e) && (key(e) === "delete" || key(e) === "backspace"),
    run: ({ e, state }) => {
      if (state.selectedWorkItemIds.length > 0 || state.selectedBacklogIds.length > 0) {
        e.preventDefault();
        const direction = e.key === "Backspace" ? "up" : "down";
        deleteDirectionRef.current = direction;
        send("shortcut:delete-selected", { direction });
      }
    },
  },
  {
    id: "duplicate",
    group: "Creating & Deleting",
    anywhere: true,
    rows: [{ keys: ["Ctrl", "D"], description: "Duplicate selected item(s)" }],
    matches: (e) => withCtrl(e) && key(e) === "d" && !e.shiftKey && !e.altKey,
    run: (ctx) => onSelectedItems("shortcut:duplicate-selected")(ctx),
  },

  // ─── Reordering ───────────────────────────────────────────────────────────
  {
    id: "to-top",
    group: "Reordering",
    rows: [{ keys: ["T"], description: "Move selection to Top" }],
    matches: (e) => plain(e) && key(e) === "t",
    run: (ctx) => rankSelectionTo(ctx, "top"),
  },
  {
    id: "to-bottom",
    group: "Reordering",
    rows: [{ keys: ["Shift", "B"], description: "Move selection to Bottom" }],
    matches: (e) => plain(e) && e.shiftKey && key(e) === "b",
    run: (ctx) => rankSelectionTo(ctx, "bottom"),
  },
  {
    id: "down",
    group: "Reordering",
    rows: [{ keys: ["O"], description: "Move item — or, with none selected, the list — down one position" }],
    matches: (e) => plain(e) && key(e) === "o",
    run: (ctx) => moveSelection(ctx, 1),
  },
  {
    id: "up",
    group: "Reordering",
    rows: [{ keys: ["U"], description: "Move item — or, with none selected, the list — up one position" }],
    matches: (e) => plain(e) && key(e) === "u",
    run: (ctx) => moveSelection(ctx, -1),
  },

  // ─── Status ───────────────────────────────────────────────────────────────
  status("status-done", "d", "done", "Done"),
  status("status-in-progress", "i", "in_progress", "In Progress"),
  status("status-pending", "p", "pending", "Pending"),
  {
    id: "status-blocked",
    group: "Status",
    rows: [{ keys: ["B"], description: "Set status: Blocked" }],
    matches: (e) => plain(e) && !e.shiftKey && key(e) === "b",
    run: (ctx) => setSelectedStatus(ctx, "blocked", "Blocked"),
  },
  status("status-not-started", "n", "not_started", "Not Started"),

  // ─── Reparenting & Moving ─────────────────────────────────────────────────
  {
    id: "reparent",
    group: "Reparenting & Moving",
    rows: [{ keys: ["R"], description: "Reparent: open Move to Parent dialog" }],
    matches: (e) => plain(e) && key(e) === "r",
    run: onSelectedItems("shortcut:move-to-parent"),
  },
  {
    id: "move-to-list",
    group: "Reparenting & Moving",
    rows: [{ keys: ["M"], description: "Move to List dialog" }],
    matches: (e) => plain(e) && key(e) === "m",
    run: onSelectedItems("shortcut:move-to-backlog"),
  },
  {
    // Handled by WorkItemTreePanel, beside the list it acts on.
    id: "indent",
    group: "Reparenting & Moving",
    rows: [
      { keys: ["Tab"], description: "Indent: make the last child of the item above at the same level" },
      { keys: ["Shift", "Tab"], description: "Outdent: elevate to parent's level" },
    ],
  },

  // ─── Other ────────────────────────────────────────────────────────────────
  {
    id: "undo",
    group: "Other",
    anywhere: true,
    rows: [{ keys: ["Ctrl", "Z"], description: "Undo" }],
    matches: (e) => withCtrl(e) && key(e) === "z" && !e.shiftKey,
    run: ({ e, state }) => {
      e.preventDefault();
      state.undo();
    },
  },
  {
    id: "redo",
    group: "Other",
    anywhere: true,
    rows: [{ keys: ["Ctrl", "Y"], description: "Redo (also Ctrl+Shift+Z)" }],
    matches: (e) => withCtrl(e) && (key(e) === "y" || (key(e) === "z" && e.shiftKey)),
    run: ({ e, state }) => {
      e.preventDefault();
      state.redo();
    },
  },
  {
    id: "rename",
    group: "Other",
    rows: [
      { keys: ["F2"], description: "Rename first selected item" },
      { keys: ["Alt", "Enter"], description: "Rename first selected item" },
    ],
    // Before the Ctrl check, as it always was: Ctrl+F2 renames too.
    matches: (e) => (e.altKey && e.key === "Enter") || e.key === "F2",
    run: ({ e, state }) => {
      if (state.selectedWorkItemIds.length > 0) {
        e.preventDefault();
        send("shortcut:edit-title", { workItemId: state.selectedWorkItemIds[0] });
      }
    },
  },
  {
    id: "hyperlinks",
    group: "Other",
    rows: [{ keys: ["H"], description: "Edit hyperlinks" }],
    matches: (e) => plain(e) && key(e) === "h",
    run: onSelectedItems("shortcut:edit-hyperlinks"),
  },
  {
    id: "hyperlinks-ctrl",
    group: "Other",
    anywhere: true,
    rows: [{ keys: ["Ctrl", "K"], description: "Edit hyperlinks (alternative)" }],
    matches: (e) => withCtrl(e) && key(e) === "k",
    run: onSelectedItems("shortcut:edit-hyperlinks"),
  },
  {
    id: "assign-teams",
    group: "Other",
    rows: [{ keys: ["A"], description: "Assign teams to the selected item(s)" }],
    matches: (e) => plain(e) && key(e) === "a",
    run: onSelectedItems("shortcut:open-team-assign"),
  },
  {
    id: "log-time",
    group: "Other",
    rows: [{ keys: ["L"], description: "Log spent time" }],
    matches: (e) => plain(e) && !e.shiftKey && key(e) === "l",
    run: ({ e, state }) => {
      if (state.selectedWorkItemIds.length > 0 && isTimeLoggingEnabled(useOrgStore.getState().activeOrgId)) {
        e.preventDefault();
        send("shortcut:log-time");
      }
    },
  },
  {
    // Reads the time back: who spent it on what. Unlike logging, it needs
    // nothing selected — the question is about everyone.
    id: "timesheet",
    group: "Other",
    rows: [{ keys: ["Shift", "L"], description: "Logged time: who spent it on what" }],
    matches: (e) => plain(e) && e.shiftKey && key(e) === "l",
    run: ({ e, openTimesheet }) => {
      if (isTimeLoggingEnabled(useOrgStore.getState().activeOrgId)) {
        e.preventDefault();
        openTimesheet();
      }
    },
  },
  {
    // Handled by WorkItemTreePanel, which owns the search box.
    id: "search",
    group: "Other",
    rows: [{ keys: ["/"], description: "Focus search bar" }],
  },
  {
    id: "help",
    group: "Other",
    rows: [{ keys: ["?"], description: "Toggle this list of shortcuts" }],
    matches: (e) => plain(e) && key(e) === "?",
    run: ({ e, toggleShortcutsOverlay }) => {
      e.preventDefault();
      toggleShortcutsOverlay();
    },
  },
];

/** Is this key press typed into a text field? */
function typingIn(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * Answer a key press with the shortcut it is, if any. The `anywhere` ones are
 * tried first; then, while typing in a field or with a dialog open, nothing
 * else answers.
 */
export function handleShortcut(e: KeyboardEvent, context: Omit<ShortcutContext, "e" | "state">): void {
  const ctx = (): ShortcutContext => ({ ...context, e, state: useAppStore.getState() });
  for (const s of SHORTCUTS) {
    if (s.anywhere && s.matches?.(e)) {
      s.run?.(ctx());
      return;
    }
  }
  if (typingIn(e)) return;
  // Don't fire global shortcuts when a modal dialog is open (e.g. reparent dialog).
  if (context.dialogWasOpen || document.querySelector('[role="dialog"]')) return;
  for (const s of SHORTCUTS) {
    if (!s.anywhere && s.matches?.(e)) {
      s.run?.(ctx());
      return;
    }
  }
}

/** The shortcuts as the guide and the overlay list them, section by section. */
export function shortcutRowsByGroup(): Array<{ group: ShortcutGroup; rows: Array<{ keys: string[]; description: string }> }> {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    rows: SHORTCUTS.filter((s) => s.group === group).flatMap((s) => s.rows),
  }));
}
