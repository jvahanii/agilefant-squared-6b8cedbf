import { useAppStore } from "@/store/appStore";
import { useTeamStore } from "@/store/teamStore";
import { WorkItem, getEffectiveParentId } from "@/types/models";
import { useBacklogStatusesStore } from "@/store/backlogStatusesStore";
import { FileText } from "lucide-react";
import { BoardView } from "./BoardView";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { TimelineView } from "./TimelineView";
import { useStartEndDatesEnabled } from "@/lib/workItemStartEnd";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useScramble } from "@/contexts/ScrambleContext";
import { useTreeSharesStore } from "@/store/treeSharesStore";
import { useClosedPostingsStore } from "@/store/closedPostingsStore";
import { currentListSortContext, useListSortMode } from "@/store/listSortStore";
import { atTopFirst, sortTopLevel } from "@/lib/listSort";
import { buildVisibleRows, effectiveChildren, topLevelItems } from "@/lib/workItemRows";
import { observeWidthForRemeasure } from "@/lib/virtualRows";
import { useLabelsStore } from "@/store/labelsStore";
import {
  useSnoozeStore,
} from "@/store/snoozeStore";
import { visibleWorkItemIdsRef } from "@/store/navigationRefs";
import { LabelFilterContext, RunningNumberContext, SharedDataContext, scrollWorkItemIntoView, type SharedData } from "./workItemRow/rowShared";
import { InlineWorkItemInput } from "./workItemRow/InlineWorkItemInput";
import { WorkItemNode } from "./workItemRow/WorkItemRow";
import { FilterBar } from "./listPanel/FilterBar";
import { ListHeader, ResultsHeader } from "./listPanel/ListHeader";
import { FilterResultsList, SearchResultsList } from "./listPanel/SearchResults";
import { useItemSearch, type SearchResult } from "./listPanel/useItemSearch";
import { useListFilters } from "./listPanel/useListFilters";
import { useAddShortcuts, useRevealRows, useTabReparent } from "./listPanel/useListKeys";

function ReorderDropZone({
  id,
  index,
  treeId,
  backlogIds,
  parentId,
  depth,
  targetBacklogId,
}: {
  id: string;
  index: number;
  treeId: string;
  backlogIds: string[];
  parentId: string | null;
  depth: number;
  targetBacklogId?: string;
}) {
  const isMobile = useIsMobile();
  const { active } = useDndContext();
  const isDragActive = active !== null;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "workitem-reorder", index, treeId, backlogIds, parentId, backlogId: targetBacklogId },
  });

  return (
    <div
      className="relative py-px"
      style={{ marginLeft: `${depth * 20 + 12}px` }}
    >
      {/* Absolutely-positioned hit area: expands during drag without shifting layout.
          Bigger zones make reorder gaps far easier to hit with a mouse. */}
      <div
        ref={setNodeRef}
        className={`absolute inset-x-0 ${isDragActive ? (isMobile ? "-top-2 -bottom-2" : "-top-2.5 -bottom-2.5") : "inset-y-0"}`}
      />
      {/* Indicator is absolutely positioned so showing it doesn't change layout
          (which previously caused the hit area to shift and oscillate isOver). */}
      {isOver && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-selection shadow-[0_0_0_3px_hsl(var(--selection)/0.25)]" />
      )}
    </div>
  );
}

function WorkItemRootDropZone({
  treeId,
  backlogId,
  children,
}: {
  treeId: string;
  backlogId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `workitem-root-drop-${backlogId}`,
    data: { type: "workitem-root", treeId, backlogId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-0 flex flex-col ${isOver ? "ring-2 ring-selection/40 ring-inset rounded-md" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * The work items of the list chosen on the left, as a tree — or as a board or
 * a timeline — under its header and the filter box. While searching, or
 * filtering by label or team, the tree gives way to a flat list of results
 * from every tree.
 *
 * The parts: FilterBar with useItemSearch and useListFilters, SearchResults,
 * ListHeader, and the keys in useListKeys. What is left here is the tree:
 * which rows show, in what order, drawn as they scroll into view.
 */
export function WorkItemTreePanel() {
  const selectedBacklogIds = useAppStore((s) => s.selectedBacklogIds);
  const selectedBacklogId = selectedBacklogIds[0] ?? null;
  const selectedTreeId = useAppStore((s) => s.selectedTreeId);
  const workItems = useAppStore((s) => s.workItems);
  const workItemsLoading = useAppStore((s) => s.workItemsLoading);
  // Cached data on screen while the real data is still coming: an empty list
  // may just not have arrived yet.
  const workItemsRefreshing = useAppStore((s) => s.workItemsRefreshing);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const expandedWorkItems = useAppStore((s) => s.expandedWorkItems);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const clearWorkItemSelection = useAppStore((s) => s.clearWorkItemSelection);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const labelsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const boardsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.boardsEnabled ?? false);
  const isMobile = useIsMobile();

  // Compute the set of currently-snoozed item IDs. The selector returns a
  // stable comma-joined string so zustand only triggers a re-render when the
  // snoozed-ID set actually changes (new snooze, unsnooze, or expiry via tick).
  const snoozedKey = useSnoozeStore((s) => {
    void s.tick; // read tick so expiry wakes are reflected
    const now = Date.now();
    return Object.values(s.snoozes)
      .filter((snooze) => new Date(snooze.snoozedUntil).getTime() > now)
      .map((snooze) => snooze.workItemId)
      .sort()
      .join(',');
  });
  const snoozedItemIds = useMemo(
    () => new Set(snoozedKey ? snoozedKey.split(',') : []),
    [snoozedKey],
  );

  // View mode is persisted per backlog in the database (shared across users
  // viewing the same backlog).  Falls back to "list" when the selected backlog
  // has no stored preference.
  const setBacklogViewMode = useAppStore((s) => s.setBacklogViewMode);
  const viewMode = useAppStore((s) => {
    if (!selectedBacklogId) return "list" as const;
    return s.backlogs[selectedBacklogId]?.viewMode ?? "list";
  });
  const setViewMode = useCallback((m: "list" | "board" | "timeline") => {
    if (!selectedBacklogId) return;
    setBacklogViewMode(selectedBacklogId, m);
  }, [selectedBacklogId, setBacklogViewMode]);
  // The timeline is drawn from start and end dates, so it is offered where the
  // organization uses them. A list that prefers it while they are switched
  // off shows as a list, and goes back to its timeline if they return.
  const timelineAvailable = useStartEndDatesEnabled();
  const showTimeline = timelineAvailable && viewMode === "timeline";

  // Clear search query when switching backlogs
  useEffect(() => {
    setSearchQuery("");
  }, [selectedBacklogId, setSearchQuery]);

  const search = useItemSearch();
  const filters = useListFilters(selectedBacklogId);
  const isSearchMode = search.active;
  const isFilterMode = filters.active;
  const visibleFilterSet = filters.visible;

  // Scramble support: check whether the currently selected tree is shared with any org.
  // If it is shared, names in it are NOT scrambled even when scramble is enabled.
  const { scrambleEnabled } = useScramble();
  // From the read the tree panel makes for every tree (treeSharesStore.ts). Until
  // it answers the tree counts as not shared; if it failed, as shared, so that
  // names are not exposed when that is not known.
  const shareTreeIdsKey = Object.keys(backlogTrees).sort().join(",");
  useEffect(() => {
    if (!activeOrgId || !shareTreeIdsKey) return;
    useTreeSharesStore.getState().ensure(activeOrgId, shareTreeIdsKey.split(","));
  }, [activeOrgId, shareTreeIdsKey]);
  const selectedTreeIsShared = useTreeSharesStore(
    (s) => !!selectedTreeId && (s.failed || (s.byTree[selectedTreeId]?.length ?? 0) > 0),
  );

  // A tree's content is scrambled only when scramble is enabled AND the tree is not shared.
  const isScrambled = scrambleEnabled && !selectedTreeIsShared;

  const [isAdding, setIsAdding] = useState(false);
  const lastSelectedId = useRef<string | null>(null);
  useAddShortcuts(() => setIsAdding(true));

  const backlogIdSet = useMemo(() => {
    if (!selectedBacklogId) return new Set<string>();
    const ids = new Set<string>();
    const collect = (id: string) => {
      ids.add(id);
      backlogs[id]?.childrenIds.forEach(collect);
    };
    collect(selectedBacklogId);
    return ids;
  }, [selectedBacklogId, backlogs]);

  const allBacklogIds = useMemo(() => Array.from(backlogIdSet), [backlogIdSet]);

  // The order the top level is shown in. Rank unless this browser chose another
  // order for this backlog; that choice only rearranges the view, and children
  // always stay in rank order. Teams and statuses are read so a re-sort follows
  // when someone changes them.
  const listSortMode = useListSortMode(selectedBacklogId);
  const closedAtTop = useClosedPostingsStore((s) => s.atTop);
  const sortTeams = useTeamStore((s) => s.teams);
  const sortWorkItemTeams = useTeamStore((s) => s.workItemTeams);
  const sortStatusesByBacklog = useBacklogStatusesStore((s) => s.statusesByBacklog);
  const rootWorkItems = useMemo(() => {
    if (!selectedBacklogId || !selectedTreeId || backlogIdSet.size === 0) return [];
    // Read by currentListSortContext through getState; named here so the order
    // is recomputed when they change.
    void sortTeams;
    void sortWorkItemTeams;
    void sortStatusesByBacklog;
    // Closed ads a finished check found go first, in this browser only.
    return atTopFirst(
      sortTopLevel(
        topLevelItems(workItems, selectedTreeId, backlogIdSet),
        listSortMode,
        selectedTreeId,
        currentListSortContext(selectedTreeId),
      ),
      closedAtTop,
    );
  }, [workItems, selectedBacklogId, selectedTreeId, backlogIdSet, listSortMode, sortTeams, sortWorkItemTeams, sortStatusesByBacklog, closedAtTop]);

  // When filter is active, hide root items that have no matching descendant-or-self.
  // Also hide root items that are currently snoozed by the current user.
  const displayedRootItems = useMemo(() => {
    let items = rootWorkItems;
    if (visibleFilterSet) items = items.filter((wi) => visibleFilterSet.has(wi.id));
    return items.filter((wi) => !snoozedItemIds.has(wi.id));
  }, [rootWorkItems, visibleFilterSet, snoozedItemIds]);

  // The rows top to bottom and their indentation, from one walk that follows
  // each item's parent in this tree (lib/workItemRows). Depth used to be
  // reconstructed afterwards from global parents, which put every row after a
  // re-parented multi-tree item at the top level.
  const visibleRows = useMemo(
    () =>
      selectedTreeId
        ? buildVisibleRows(displayedRootItems.map((r) => r.id), expandedWorkItems, workItems, selectedTreeId, backlogIdSet)
        : { ids: displayedRootItems.map((r) => r.id), depths: new Map<string, number>() },
    [displayedRootItems, expandedWorkItems, workItems, selectedTreeId, backlogIdSet],
  );
  const visibleItemIds = visibleRows.ids;
  const itemDepthMap = visibleRows.depths;

  // For each visible row, compute its sibling-context parent and the drop-zone
  // index *within that sibling group*. The virtualizer's flat index cannot be
  // used directly as a reorder target: in a mixed-depth tree the flat index is
  // larger than the sibling-relative index that reorderWorkItemAmongSiblings
  // expects, so drops would clamp to the bottom (or land in the wrong place).
  // This mirrors the sibling grouping used by the store: a row is a child of
  // its effective parent when that parent is inside the backlog context, and
  // "root-visible" otherwise (parent null or outside the context).
  const reorderDropMeta = useMemo(() => {
    const meta = new Map<number, { index: number; parentId: string | null }>();
    const counts = new Map<string, number>();
    visibleItemIds.forEach((id, i) => {
      const item = workItems[id];
      if (!item) return;
      const effectiveParent = selectedTreeId
        ? getEffectiveParentId(item, selectedTreeId)
        : item.parentId;
      const parentInContext =
        effectiveParent !== null &&
        backlogIdSet.has(
          workItems[effectiveParent]?.backlogAssignments[selectedTreeId ?? ""],
        );
      const contextKey = parentInContext ? `child:${effectiveParent}` : "root";
      const dropIndex = counts.get(contextKey) ?? 0;
      counts.set(contextKey, dropIndex + 1);
      meta.set(i, {
        index: dropIndex,
        parentId: parentInContext ? effectiveParent : null,
      });
    });
    return meta;
  }, [visibleItemIds, workItems, selectedTreeId, backlogIdSet]);

  // Virtualizer scroll container
  const panelRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  // Also as state, because the scroll container is only rendered when the
  // backlog has items: switching from an empty one mounts a *new* element, and
  // an effect keyed on the virtualizer alone would still be watching the old
  // one — or nothing at all.
  const [treeScrollEl, setTreeScrollEl] = useState<HTMLDivElement | null>(null);
  const attachTreeScroll = useCallback((node: HTMLDivElement | null) => {
    treeScrollRef.current = node;
    setTreeScrollEl(node);
  }, []);
  const virtualizer = useVirtualizer({
    count: visibleItemIds.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: () => 32,
    overscan: 10,
    measureElement: (el) => el.getBoundingClientRect().height,
    // Key rows (and their cached measurements) by work-item identity instead of
    // index. When an item is moved to another list and removed from this one,
    // every following item shifts to a new index; index-based keys would make
    // each row adopt the stale multi-line height of the previous occupant and
    // leave titles squeezed on top of each other on mobile.
    getItemKey: (index) => visibleItemIds[index] ?? index,
  });

  // Titles wrap onto multiple rows, so a row's height depends on the available
  // width. When the container width changes (mobile pane expand/collapse,
  // rotation, sidebar toggle) cached measurements go stale and rows can end up
  // painted on top of each other — read the rendered rows again.
  //
  // Not virtualizer.measure(): that clears every cached height back to the
  // 32px estimate, and rows keyed by item id keep their DOM nodes, so the
  // measureElement refs never re-run and the real heights never come back.
  // That left a wrapped title in a one-line slot with the next row on top of
  // it. Watching the width is delicate in its own right — re-measuring can
  // toggle the scrollbar, which changes the width again — so lib/virtualRows
  // watches offsetWidth, measures on the next frame, and gives up if the width
  // will not settle. Measuring on clientWidth here froze the live app.
  useEffect(() => observeWidthForRemeasure(treeScrollEl, virtualizer.measureElement), [treeScrollEl, virtualizer]);

  // A change to the visible set (expand / collapse, add, delete, filter, move
  // to another list) needs nothing here: heights are cached by work-item
  // identity (see getItemKey above), so existing rows keep theirs and new rows
  // measure on mount.

  // Keep a ref to the latest visible list so the Tab/Shift-Tab handler always
  // operates on the current order without requiring the effect to re-register.
  const visibleItemIdsRef = useRef<string[]>(visibleItemIds);
  useEffect(() => {
    visibleItemIdsRef.current = visibleItemIds;
    // The timeline shows every row with its branches open, and publishes its
    // own order for the arrow keys; the list's would move the selection onto
    // rows the timeline does not show in that place.
    if (!showTimeline) visibleWorkItemIdsRef.current = visibleItemIds;
  }, [visibleItemIds, showTimeline]);
  const timelineRootIds = useMemo(() => displayedRootItems.map((r) => r.id), [displayedRootItems]);
  // Read by the Tab handler, which is registered once.
  const showTimelineRef = useRef(showTimeline);
  showTimelineRef.current = showTimeline;

  // Scroll a work item into view even when it isn't currently rendered by the
  // virtualizer (e.g. navigating from search/label results to an item far
  // outside the current window). virtualizer.scrollToIndex works from the list
  // index regardless of whether the target row is mounted yet; the follow-up
  // scrollIntoView corrects any drift from the dynamic row-height estimates.
  const scrollToWorkItem = useCallback(
    (itemId: string) => {
      const index = visibleItemIdsRef.current.indexOf(itemId);
      if (index === -1) {
        scrollWorkItemIntoView(itemId);
        return;
      }
      virtualizer.scrollToIndex(index, { align: "auto" });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-work-item-id="${CSS.escape(itemId)}"]`)
            ?.scrollIntoView({ block: "nearest" });
        });
      });
    },
    [virtualizer],
  );

  useRevealRows(visibleItemIdsRef, scrollToWorkItem);
  useTabReparent(visibleItemIdsRef, showTimelineRef);

  // Assign a 1-based running number to each item that will actually be rendered
  // (i.e. not snoozed and not hidden by the label filter).  The numbers are
  // contiguous with no gaps, matching the visual top-to-bottom order.
  //
  // Every row reads these, so the map stays the same object while the numbers
  // stay the same: a new one after each change to an item, such as a rename,
  // drew every row again.
  const lastRunningNumbers = useRef<Map<string, number>>(new Map());
  const runningNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let counter = 1;
    // The same children, in the same order, as the rows (buildVisibleRows).
    const traverse = (workItemId: string) => {
      const item = workItems[workItemId];
      if (!item || map.has(workItemId)) return;
      if (snoozedItemIds.has(workItemId)) return;
      if (visibleFilterSet !== null && !visibleFilterSet.has(workItemId)) return;
      map.set(workItemId, counter++);
      if (expandedWorkItems.has(workItemId) && selectedTreeId) {
        effectiveChildren(workItemId, workItems, selectedTreeId, backlogIdSet).forEach((child) => traverse(child.id));
      }
    };
    displayedRootItems.forEach((root) => traverse(root.id));
    const before = lastRunningNumbers.current;
    if (before.size === map.size && [...map].every(([id, n]) => before.get(id) === n)) return before;
    lastRunningNumbers.current = map;
    return map;
  }, [displayedRootItems, expandedWorkItems, workItems, selectedTreeId, backlogIdSet, snoozedItemIds, visibleFilterSet]);

  // The same function for as long as the panel is there: every row is handed
  // it, and a new one with each new list of rows (which any change to an item
  // makes) drew every row again. The rows are read when it is called.
  const handleSelect = useCallback(
    (id: string, multi: boolean, shift: boolean) => {
      const ids = visibleItemIdsRef.current;
      if (shift && lastSelectedId.current && ids.includes(lastSelectedId.current)) {
        const startIdx = ids.indexOf(lastSelectedId.current);
        const endIdx = ids.indexOf(id);
        const rangeIds = ids.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);

        useAppStore.getState().selectWorkItemRange(rangeIds, multi);
      } else {
        selectWorkItem(id, multi);
        lastSelectedId.current = id;
      }
    },
    [selectWorkItem],
  );

  /**
   * Go to an item from the results: open its list and the items above it, and
   * once the list is drawn, select it and bring it into view. A snoozed item
   * is woken, or it would not be there to see.
   */
  const goToItem = (item: WorkItem, treeId: string, backlogId: string) => {
    if (useSnoozeStore.getState().isSnoozed(item.id)) {
      useSnoozeStore.getState().unsnoozeWorkItem(item.id);
    }
    useAppStore.setState((state) => {
      const expandedBacklogs = new Set(state.expandedBacklogs);
      let bl = state.backlogs[backlogId];
      while (bl?.parentId) {
        expandedBacklogs.add(bl.parentId);
        bl = state.backlogs[bl.parentId];
      }
      const expandedWorkItems = new Set(state.expandedWorkItems);
      let wi = state.workItems[item.id];
      while (wi) {
        const pid = getEffectiveParentId(wi, treeId);
        if (!pid) break;
        expandedWorkItems.add(pid);
        wi = state.workItems[pid];
      }
      return { expandedBacklogs, expandedWorkItems };
    });
    selectBacklog(backlogId, treeId);
    // Small delay lets the backlog panel re-render with the new selection
    // before we try to highlight the work item row.
    setTimeout(() => {
      selectWorkItem(item.id, false);
      scrollToWorkItem(item.id);
    }, 50);
  };

  /** Go to a search result, from a click or with Enter in the search box. */
  const openSearchResult = (result: SearchResult) => {
    if (result.kind === "backlog") {
      selectBacklog(result.backlogId, result.treeId);
      setSearchQuery("");
      return;
    }
    goToItem(result.item, result.treeId, result.backlogId);
    setSearchQuery("");
  };

  /** Add an item from the header's button: as the view in front can take one. */
  const addFromHeader = () => {
    if (viewMode === "board" && boardsVisible) {
      window.dispatchEvent(new CustomEvent("board:header-add"));
    } else if (showTimeline) {
      setViewMode("list");
      setIsAdding(true);
    } else if (isMobile && useAppStore.getState().selectedWorkItemIds.length === 1) {
      window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
    } else {
      setIsAdding(true);
    }
  };

  // Shared data computed once per panel — avoids per-row store subscriptions.
  const savingsIncomeVisible2 = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.savingsIncomeEnabled ?? false);
  const burnupsVisible2 = useOrgSettingsStore((s) => (s.settings[activeOrgId ?? ""] as { burnupsEnabled?: boolean })?.burnupsEnabled ?? false);
  const teamsStore = useTeamStore((s) => s.teams);
  const labelsStoreMap = useLabelsStore((s) => s.labels);
  const labelsStoreByEntity = useLabelsStore((s) => s.byEntity);
  const assignLabelFn = useLabelsStore((s) => s.assignLabel);
  const unassignLabelFn = useLabelsStore((s) => s.unassignLabel);
  const createLabelFn = useLabelsStore((s) => s.createLabel);
  const deleteLabelFn = useLabelsStore((s) => s.deleteLabel);
  const assignTeamFn = useTeamStore((s) => s.assignTeamToWorkItem);
  const unassignTeamFn = useTeamStore((s) => s.unassignTeamFromWorkItem);
  const orgLabelsShared = useMemo(
    () => Object.values(labelsStoreMap).filter((l) => l.organizationId === activeOrgId).sort((a, b) => a.name.localeCompare(b.name)),
    [labelsStoreMap, activeOrgId],
  );
  // The same object until one of these changes: every row reads it, and a new
  // one each time the panel draws (as on every click that selects a row) drew
  // every row again.
  const sharedData = useMemo<SharedData>(() => ({
    orgLabels: orgLabelsShared,
    teams: teamsStore,
    labelsVisible,
    labelsMap: labelsStoreMap,
    byEntity: labelsStoreByEntity,
    assignLabel: assignLabelFn,
    unassignLabel: unassignLabelFn,
    createLabel: createLabelFn,
    deleteLabel: deleteLabelFn,
    assignTeam: assignTeamFn,
    unassignTeam: unassignTeamFn,
    activeOrgId,
    timeLoggingVisible,
    savingsIncomeVisible: savingsIncomeVisible2,
    burnupsVisible: burnupsVisible2,
  }), [
    orgLabelsShared, teamsStore, labelsVisible, labelsStoreMap, labelsStoreByEntity, assignLabelFn, unassignLabelFn,
    createLabelFn, deleteLabelFn, assignTeamFn, unassignTeamFn, activeOrgId, timeLoggingVisible,
    savingsIncomeVisible2, burnupsVisible2,
  ]);

  return (
    // In search/label-filter mode the normal tree is replaced by a flat results list,
    // so pass null (no tree-level filtering) to avoid hiding nodes in the hidden tree.
    // Null already means "no filter active" per the LabelFilterContext contract.
    <SharedDataContext.Provider value={sharedData}>
    <LabelFilterContext.Provider value={isSearchMode || isFilterMode ? null : visibleFilterSet}>
    <RunningNumberContext.Provider value={isSearchMode || isFilterMode ? null : runningNumbers}>
      <div
        ref={panelRef}
        className="h-full flex flex-col overflow-hidden"
        onClick={(e) => {
          // React bubbles events through portals, so a click inside a dialog,
          // sheet or menu rendered elsewhere in the DOM still arrives here —
          // which deselected the item whose hyperlink had just been clicked.
          // Only a click on the panel's own empty space should clear it.
          if (!panelRef.current?.contains(e.target as Node)) return;
          clearWorkItemSelection();
          lastSelectedId.current = null;
        }}
      >
        <FilterBar search={search} filters={filters} labelsVisible={labelsVisible} onOpen={openSearchResult} />

        {!isSearchMode && !isFilterMode && (!selectedBacklogId || !selectedTreeId) ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm">Select a list to view work items</p>
            </div>
          </div>
        ) : (
        <>
        {!isSearchMode && !isFilterMode && selectedBacklogId && selectedTreeId ? (
          <ListHeader
            backlogId={selectedBacklogId}
            treeId={selectedTreeId}
            backlogIdSet={backlogIdSet}
            allBacklogIds={allBacklogIds}
            isScrambled={isScrambled}
            itemCount={rootWorkItems.length}
            snoozedItemIds={snoozedItemIds}
            view={{ mode: viewMode, set: setViewMode, boardsVisible, timelineAvailable, showTimeline }}
            onAdd={addFromHeader}
          />
        ) : isSearchMode ? (
          <ResultsHeader title="Search results" count={search.results?.length ?? 0} />
        ) : (
          <ResultsHeader title={filters.title} count={filters.results?.length ?? 0} />
        )}
        {!isSearchMode && !isFilterMode && showTimeline && selectedBacklogId && selectedTreeId ? (
          <TimelineView
            treeId={selectedTreeId}
            rootIds={timelineRootIds}
            backlogIds={backlogIdSet}
            isScrambled={isScrambled}
          />
        ) : !isSearchMode && !isFilterMode && boardsVisible && viewMode === "board" && selectedBacklogId && selectedTreeId ? (
          <BoardView backlogId={selectedBacklogId} treeId={selectedTreeId} addWorkItem={addWorkItem} setViewMode={setViewMode} />
        ) : isSearchMode ? (
          <SearchResultsList search={search} isScrambled={isScrambled} onOpen={openSearchResult} />
        ) : isFilterMode ? (
          <FilterResultsList
            filters={filters}
            isScrambled={isScrambled}
            onOpen={({ item, treeId, backlogId }) => {
              goToItem(item, treeId, backlogId);
              filters.clear();
            }}
          />
        ) : (
          <WorkItemRootDropZone treeId={selectedTreeId!} backlogId={selectedBacklogId!}>
          <div className="flex-1 min-h-0 flex flex-col">
            {rootWorkItems.length === 0 && isAdding ? (
              <InlineWorkItemInput
                depth={0}
                onSubmit={(title) => {
                  addWorkItem(title, null, selectedBacklogId!, selectedTreeId!, 0);
                  if (isMobile) setIsAdding(false);
                }}
                onCancel={() => setIsAdding(false)}
              />
            ) : rootWorkItems.length === 0 && !isAdding ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground" role="status" aria-live="polite">
                {workItemsLoading || workItemsRefreshing ? "Loading work items…" : "No work items in this list"}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                {isAdding && (
                  <InlineWorkItemInput
                    depth={0}
                    onSubmit={(title) => {
                      addWorkItem(title, null, selectedBacklogId!, selectedTreeId!);
                      if (isMobile) setIsAdding(false);
                    }}
                    onCancel={() => setIsAdding(false)}
                  />
                )}
                <div
                  ref={attachTreeScroll}
                  className="flex-1 overflow-y-auto p-0 md:p-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className="relative"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const i = virtualRow.index;
                      const id = visibleItemIds[i];
                      const wi = workItems[id];
                      if (!wi) return null;
                      const depth = itemDepthMap.get(id) ?? 0;
                      const dropMeta = reorderDropMeta.get(i);
                      const itemBacklogId = wi.backlogAssignments[selectedTreeId!] ?? selectedBacklogId!;
                      return (
                        <div
                          key={id}
                          data-index={i}
                          ref={virtualizer.measureElement}
                          className="absolute top-0 left-0 w-full"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <ReorderDropZone
                            id={`reorder-flat-${i}`}
                            index={dropMeta?.index ?? 0}
                            treeId={selectedTreeId!}
                            backlogIds={allBacklogIds}
                            parentId={dropMeta?.parentId ?? null}
                            depth={depth}
                            targetBacklogId={allBacklogIds.length > 1 ? itemBacklogId : undefined}
                          />
                          <WorkItemNode
                            workItemId={id}
                            depth={depth}
                            treeId={selectedTreeId!}
                            backlogId={itemBacklogId}
                            allBacklogIds={allBacklogIds}
                            parentBacklogId={selectedBacklogId!}
                            isScrambled={isScrambled}
                            selectedBacklogId={selectedBacklogId!}
                            onSelect={handleSelect}
                            setViewMode={setViewMode}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </WorkItemRootDropZone>
        )}
        </>
        )}
      </div>
    </RunningNumberContext.Provider>
    </LabelFilterContext.Provider>
    </SharedDataContext.Provider>
  );
}
