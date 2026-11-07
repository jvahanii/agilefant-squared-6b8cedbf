/**
 * The keys the list answers itself, beside the global shortcuts (lib/shortcuts):
 * Tab and Shift+Tab move the selection in and out a level; Insert adds an
 * item; and a row the selection needs is brought into view first.
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import { useAppStore } from "@/store/appStore";
import { visibleWorkItemIdsRef } from "@/store/navigationRefs";
import { toast } from "@/hooks/use-toast";
import { overlayOpen } from "@/lib/overlayLock";
import { indentTargets, rowsForReparenting } from "@/lib/workItemRows";
import { getEffectiveParentId } from "@/types/models";
import { SELECTION_SHORTCUTS, rowIsDrawn } from "../workItemRow/rowShared";

/** Tab: under the previous sibling, last. Shift+Tab: out to the parent's level. */
export function useTabReparent(
  /** The list's rows, top to bottom. */
  visibleItemIdsRef: MutableRefObject<string[]>,
  /** The timeline is shown instead of the list. */
  showTimelineRef: MutableRefObject<boolean>,
) {
  // Keyboard shortcuts: Tab = indent (last child of the previous sibling),
  // Shift+Tab = outdent (elevate to parent's level).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;
      // An open dialog keeps its Tab. Checking for a field alone was not
      // enough: from the date field the key moves to the calendar button
      // beside it, and from there the next press reparented the selected
      // item behind the dialog instead of moving on to the other date.
      if (overlayOpen()) return;

      const state = useAppStore.getState();
      if (state.selectedWorkItemIds.length === 0) return;
      if (!state.selectedTreeId || !state.selectedBacklogIds[0]) return;

      const treeId = state.selectedTreeId;
      const backlogId = state.selectedBacklogIds[0];
      // The rows on screen: the timeline's own while it is shown. Judged by
      // the list's, a row the list keeps folded away was not there to act on,
      // the key went unhandled, and the browser moved focus instead — which
      // scrolls the calendar to wherever focus landed, the bars out of sight.
      const currentIds = rowsForReparenting(showTimelineRef.current, visibleItemIdsRef.current, visibleWorkItemIdsRef.current);
      const selectedSet = new Set(state.selectedWorkItemIds);
      // Process in visible (top-to-bottom) order, restricted to currently visible items.
      const orderedSelected = currentIds.filter((id) => selectedSet.has(id));
      if (orderedSelected.length === 0) return;

      e.preventDefault();


      // Exclude items that are descendants of another selected item —
      // they'll move implicitly when their selected ancestor is reparented.
      const isDescendantOfSelected = new Set<string>();
      for (const id of orderedSelected) {
        const wi = state.workItems[id];
        let ancestor: string | null = treeId ? getEffectiveParentId(wi, treeId) : wi.parentId;
        while (ancestor) {
          if (selectedSet.has(ancestor)) {
            isDescendantOfSelected.add(id);
            break;
          }
          const ancestorWi = state.workItems[ancestor];
          ancestor = treeId && ancestorWi ? getEffectiveParentId(ancestorWi, treeId) : ancestorWi?.parentId ?? null;
        }
      }


      const topmostSelected = orderedSelected.filter((id) => !isDescendantOfSelected.has(id));

      if (e.shiftKey) {
        // Outdent: each selected item becomes a sibling of its current parent.



        // Snapshot parent ids first so reparenting doesn't affect later lookups.
        // Only the topmost: a selected item under another selected one moves with it.
        const outdentedAfter = new Map<string, number>();
        const plans = topmostSelected
          .map((id) => {
            const item = state.workItems[id];
            const effectiveParentId = treeId ? getEffectiveParentId(item, treeId) : item.parentId;
            if (!item || effectiveParentId === null) return null;
            const parent = state.workItems[effectiveParentId];
            if (!parent) return null;
            const grandparentId = treeId ? getEffectiveParentId(parent, treeId) : parent.parentId;
            const targetBacklogId = grandparentId
              ? (state.workItems[grandparentId]?.backlogAssignments[treeId] ?? backlogId)
              : backlogId;
            // Right after its former parent — and after any sibling outdented
            // before it from the same parent, or a run of them came out reversed.
            const parentRank = parent.ranks[targetBacklogId] ?? 0;
            const before = outdentedAfter.get(effectiveParentId) ?? 0;
            outdentedAfter.set(effectiveParentId, before + 1);
            const insertRank = parentRank + 1 + before;
            return { id, grandparentId, targetBacklogId, insertRank };
          })
          .filter((p): p is { id: string; grandparentId: string | null; targetBacklogId: string; insertRank: number } => p !== null);
        if (plans.length === 0) return;
        useAppStore.getState().runBulk(() => {
          plans.forEach((p) => state.reparentWorkItem(p.id, p.grandparentId, treeId, p.targetBacklogId, undefined, p.insertRank));
        });
        toast({
          title:
            plans.length === 1
              ? plans[0].grandparentId
                ? `Reparented to "${state.workItems[plans[0].grandparentId!]?.title ?? "item"}"`
                : "Moved to root (no parent)"
              : `Outdented ${plans.length} items`,
        });
      } else {
        // Indent: each selected item goes under its previous sibling, at the end
        // of that sibling's children (indentTargets).
        const targets = indentTargets(currentIds, selectedSet, (id) => {
          const wi = state.workItems[id];
          return wi ? getEffectiveParentId(wi, treeId) : null;
        });
        const plans: { id: string; parentId: string; targetBacklogId: string }[] = [];
        for (const id of topmostSelected) {
          const parentId = targets.get(id);
          if (!parentId) continue;
          const parentItem = state.workItems[parentId];
          if (!parentItem) continue;
          const targetBacklogId = parentItem.backlogAssignments[treeId] ?? backlogId;
          plans.push({ id, parentId, targetBacklogId });
        }
        if (plans.length === 0) return;
        useAppStore.getState().runBulk(() => {
          plans.forEach((p) => state.reparentWorkItem(p.id, p.parentId, treeId, p.targetBacklogId));
        });
        // Expand new parents so indented items stay visible.
        const latest = useAppStore.getState();
        const uniqueParents = Array.from(new Set(plans.map((p) => p.parentId)));
        uniqueParents.forEach((pid) => {
          if (!latest.expandedWorkItems.has(pid)) latest.toggleWorkItemExpand(pid);
        });
        toast({
          title:
            plans.length === 1
              ? `Reparented to "${state.workItems[plans[0].parentId]?.title ?? "item"}"`
              : `Indented ${plans.length} items`,
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visibleItemIdsRef, showTimelineRef]);
}

/** "Add" from the shortcuts, and Insert: a child of the selected item, or a new item at the top. */
export function useAddShortcuts(startAdding: () => void) {
  // Bound once; they call the latest.
  const startRef = useRef(startAdding);
  startRef.current = startAdding;
  useEffect(() => {
    const handler = () => startRef.current();
    window.addEventListener("shortcut:add-workitem", handler);
    return () => window.removeEventListener("shortcut:add-workitem", handler);
  }, []);

  // Insert key: add child item when an item is selected, otherwise add root item.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Insert") return;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;
      // Don't fire when a modal dialog is open
      if (document.querySelector('[role="dialog"]')) return;

      e.preventDefault();
      const sel = useAppStore.getState().selectedWorkItemIds;
      if (sel.length > 0) {
        window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"));
      } else {
        startRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

/** Bring into view the rows the arrow keys and the selection's shortcuts need. */
export function useRevealRows(
  visibleItemIdsRef: MutableRefObject<string[]>,
  scrollToWorkItem: (id: string) => void,
) {
  // Arrow-key navigation moves the selection one row at a time; the list has
  // to follow it past the edge of the view, including onto rows the
  // virtualizer has not drawn yet. Only the list that shows the row answers.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id && visibleItemIdsRef.current.includes(id)) scrollToWorkItem(id);
    };
    window.addEventListener("shortcut:reveal-work-item", handler);
    return () => window.removeEventListener("shortcut:reveal-work-item", handler);
  }, [scrollToWorkItem, visibleItemIdsRef]);

  // A shortcut on the selection whose first item's row is not drawn — scrolled
  // out of the window the list draws — goes unanswered. Bring the row into
  // view, and once it is drawn, and listening, send the shortcut again.
  useEffect(() => {
    let cancelled = false;
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ revealed?: boolean }>).detail?.revealed) return;
      const first = useAppStore.getState().selectedWorkItemIds[0];
      if (!first || rowIsDrawn(first) || !visibleItemIdsRef.current.includes(first)) return;
      scrollToWorkItem(first);
      let frames = 0;
      const resend = () => {
        if (cancelled) return;
        if (rowIsDrawn(first)) {
          window.dispatchEvent(new CustomEvent(e.type, { detail: { revealed: true } }));
        } else if (++frames < 60) {
          requestAnimationFrame(resend);
        }
      };
      requestAnimationFrame(resend);
    };
    for (const name of SELECTION_SHORTCUTS) window.addEventListener(name, handler);
    return () => {
      cancelled = true;
      for (const name of SELECTION_SHORTCUTS) window.removeEventListener(name, handler);
    };
  }, [scrollToWorkItem, visibleItemIdsRef]);
}
