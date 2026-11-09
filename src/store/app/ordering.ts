/**
 * Putting items in order: dragged within a list or on a board, sorted by name,
 * or ranked as given. Taken out of appStore.ts word for word.
 */
import type { WorkItem, WorkItemStatus } from "@/types/models";
import { getEffectiveParentId } from "@/types/models";
import { upsertWorkItem, type WorkItemBacklogRankUpsert, type WorkItemBoardRankUpsert } from "../supabaseSync";
import { getEffectiveStatuses } from "../backlogStatusesStore";
import { redistributeRanksByStatus, listRanksFollowingColumn } from "@/lib/rankSync";
import { boardColumnKey, byBoardRank } from "@/lib/boardColumn";
import { byRank } from "@/lib/workItemRows";
import type { AppState, GetState, LogChange, SetState } from "./types";
import { getWorkItemRank, ensureCleanId } from "./hierarchy";
import { pushUndoEntry } from "./history";
import { persistRankUpserts, persistBoardRankUpserts } from "./writeQueue";

export type OrderingActions = Pick<
  AppState,
  | "reorderWorkItemAmongSiblings"
  | "sortChildrenAlphabetically"
  | "applySiblingOrder"
  | "reorderWorkItemInBoard"
>;

export function orderingActions(set: SetState, get: GetState, internalLog: LogChange): OrderingActions {
  return {
    reorderWorkItemAmongSiblings: (workItemId, targetIndex, treeId, backlogIds) => {
      const state = get();
      const orgId = state.organizationId!;
      const mainItem = state.workItems[workItemId];
      if (!mainItem) return;

      const itemsToMoveIds = state.selectedWorkItemIds.includes(workItemId) ? state.selectedWorkItemIds : [workItemId];
      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));

      // Determine if mainItem is a "root-visible" item in this view: its parent is absent
      // from the backlog context (or has no parent at all).  Items like sub-tasks of a
      // "Collab AI" project that are also tagged for "Today" fall into this category –
      // they appear at the root level of the flat view even though parentId is non-null.
      // In that case we must treat ALL root-visible items as siblings so that moving to
      // top/bottom ranks the item relative to every item shown at that visual level, not
      // just the tiny group that shares the same parentId.
      const mainEffectiveParentId = getEffectiveParentId(mainItem, treeId);
      const mainParentInContext =
        mainEffectiveParentId !== null &&
        backlogIdSet.has(state.workItems[mainEffectiveParentId]?.backlogAssignments[treeId]);

      const allSiblings = Object.values(state.workItems)
        .filter((wi) => {
          if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
          const wiEffectiveParentId = getEffectiveParentId(wi, treeId);
          if (mainParentInContext) {
            // mainItem is a true child inside this context – use standard same-parent matching.
            return wiEffectiveParentId === mainEffectiveParentId;
          }
          // mainItem is root-visible: include every item whose parent is also absent from
          // the backlog context (covers both parentId=null and cross-context sub-tasks).
          const wiParentInContext =
            wiEffectiveParentId !== null &&
            backlogIdSet.has(state.workItems[wiEffectiveParentId]?.backlogAssignments[treeId]);
          return !wiParentInContext;
        })
        .sort((a, b) => {
          const rankDiff = getWorkItemRank(a, treeId) - getWorkItemRank(b, treeId);
          return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
        });

      const movingSet = new Set(itemsToMoveIds);
      const remaining = allSiblings.filter((s) => !movingSet.has(s.id));
      // targetIndex is a drop-zone index into the *full* sorted sibling list (0 = before
      // the first item, allSiblings.length = after the last item).  To convert it to an
      // insertion index into `remaining` we subtract the number of moving items whose
      // original position in allSiblings was before the target zone.
      const movingBeforeTarget = allSiblings.filter((s, i) => movingSet.has(s.id) && i < targetIndex).length;
      const adjustedTarget = targetIndex - movingBeforeTarget;
      const clampedIdx = Math.max(0, Math.min(adjustedTarget, remaining.length));

      const movingItems = allSiblings.filter((s) => movingSet.has(s.id));
      const reordered = [...remaining];
      reordered.splice(clampedIdx, 0, ...movingItems);

      const updatedItems = { ...state.workItems };

      // Determine the backlog ID for each sibling in this tree context and
      // update only that backlog's rank entry.
      reordered.forEach((s, i) => {
        const blId = updatedItems[s.id].backlogAssignments[treeId];
        if (blId) {
          updatedItems[s.id] = {
            ...updatedItems[s.id],
            ranks: { ...updatedItems[s.id].ranks, [blId]: i },
          };
        }
      });

      // Re-sort the parent's childrenIds to match the new rank order so the
      // tree panel immediately reflects the reordered positions and
      // "bounceback-creep" is prevented (the old childrenIds order would
      // otherwise survive until a realtime event re-sorts it).
      if (mainParentInContext && mainEffectiveParentId && updatedItems[mainEffectiveParentId]) {
        const parent = updatedItems[mainEffectiveParentId];
        const sortedChildren = [...parent.childrenIds].sort((a, b) => {
          const wiA = updatedItems[a];
          const wiB = updatedItems[b];
          if (!wiA || !wiB) return 0;
          const blA = wiA.backlogAssignments[treeId];
          const blB = wiB.backlogAssignments[treeId];
          const rA = blA ? (wiA.ranks[blA] ?? 0) : 0;
          const rB = blB ? (wiB.ranks[blB] ?? 0) : 0;
          return rA !== rB ? rA - rB : a.localeCompare(b);
        });
        updatedItems[mainEffectiveParentId] = { ...parent, childrenIds: sortedChildren };
      }

      // ---- Keep the board consistent with the new list order ---------------
      // Same-status siblings in the same backlog must appear in the same
      // relative order in both views. Redistribute the board-rank slots that
      // group already holds, following the new list order. Items of other
      // statuses keep their board positions untouched.
      const boardMembers = reordered.flatMap((s) => {
        const wi = updatedItems[s.id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) return [];
        return [{ id: wi.id, status: `${blId}::${wi.status}`, rank: wi.boardRanks?.[blId] ?? wi.ranks[blId] ?? 0 }];
      });
      const syncedBoardRanks = redistributeRanksByStatus(boardMembers, reordered.map((s) => s.id));
      const syncedBoardRows: WorkItemBoardRankUpsert[] = [];
      for (const [id, rank] of Object.entries(syncedBoardRanks)) {
        const wi = updatedItems[id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) continue;
        updatedItems[id] = { ...wi, boardRanks: { ...(wi.boardRanks ?? {}), [blId]: rank } };
        syncedBoardRows.push({ workItemId: id, backlogId: blId, rank, organizationId: wi.organizationId ?? orgId });
      }
      if (syncedBoardRows.length > 0) persistBoardRankUpserts(syncedBoardRows);

      persistRankUpserts(
        reordered.flatMap((s) => {
          const updated = updatedItems[s.id];
          const blId = updated.backlogAssignments[treeId];
          if (!blId) return [];
          return { workItemId: updated.id, backlogId: blId, rank: updated.ranks[blId] ?? 0, organizationId: updated.organizationId ?? orgId };
        }),
      );
      internalLog({ action: "Reorder", entityType: "work_item", entityId: workItemId, entityName: mainItem.title, details: `${itemsToMoveIds.length} items moved` });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    sortChildrenAlphabetically: (parentId, treeId, backlogIds) => {
      const state = get();
      const orgId = state.organizationId!;
      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));

      // Collect the siblings at this level using the same visibility logic as
      // reorderWorkItemAmongSiblings: items whose parent is `parentId` (or
      // root-visible items when parentId is null).
      const siblings = Object.values(state.workItems)
        .filter((wi) => {
          if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
          const wiEffectiveParentId = getEffectiveParentId(wi, treeId);
          if (parentId !== null) {
            return wiEffectiveParentId === parentId;
          }
          // Root-visible: parent not present in this backlog context.
          const wiParentInContext =
            wiEffectiveParentId !== null &&
            backlogIdSet.has(state.workItems[wiEffectiveParentId]?.backlogAssignments[treeId]);
          return !wiParentInContext;
        })
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" }));

      get().applySiblingOrder(
        parentId,
        treeId,
        backlogIds,
        siblings.map((s) => s.id),
        `${siblings.length} items sorted alphabetically`,
      );
    },

    applySiblingOrder: (parentId, treeId, _backlogIds, orderedIds, logDetails) => {
      const state = get();
      const orgId = state.organizationId!;
      const siblings = orderedIds.map((id) => state.workItems[id]).filter((wi): wi is WorkItem => !!wi);

      if (siblings.length === 0) return;

      const updatedItems = { ...state.workItems };
      siblings.forEach((s, i) => {
        const blId = updatedItems[s.id].backlogAssignments[treeId];
        if (blId) {
          updatedItems[s.id] = {
            ...updatedItems[s.id],
            ranks: { ...updatedItems[s.id].ranks, [blId]: i },
          };
        }
      });

      // Re-sort the parent's childrenIds to match the alphabetical order.
      if (parentId && updatedItems[parentId]) {
        const newOrder = siblings.map((s) => s.id);
        // Merge any children that weren't in the sorted context (e.g. from
        // other backlogs) at the end so they don't get dropped.
        const otherChildren = updatedItems[parentId].childrenIds.filter(
          (cid) => !newOrder.includes(cid),
        );
        updatedItems[parentId] = {
          ...updatedItems[parentId],
          childrenIds: [...newOrder, ...otherChildren],
        };
      }

      // Keep same-status siblings in the same relative order on the board.
      const sortedBoardMembers = siblings.flatMap((s) => {
        const wi = updatedItems[s.id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) return [];
        return [{ id: wi.id, status: `${blId}::${wi.status}`, rank: wi.boardRanks?.[blId] ?? wi.ranks[blId] ?? 0 }];
      });
      const sortedBoardRanks = redistributeRanksByStatus(sortedBoardMembers, siblings.map((s) => s.id));
      const sortedBoardRows: WorkItemBoardRankUpsert[] = [];
      for (const [id, rank] of Object.entries(sortedBoardRanks)) {
        const wi = updatedItems[id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) continue;
        updatedItems[id] = { ...wi, boardRanks: { ...(wi.boardRanks ?? {}), [blId]: rank } };
        sortedBoardRows.push({ workItemId: id, backlogId: blId, rank, organizationId: wi.organizationId ?? orgId });
      }
      // Only the ranks that changed are written. Saving a list's shown order
      // after an import moves the new items in and shifts the rest — but a
      // re-sort that leaves most of a long list where it was has no need to
      // rewrite all of it.
      const changedBoardRows = sortedBoardRows.filter(
        (row) => state.workItems[row.workItemId]?.boardRanks?.[row.backlogId] !== row.rank,
      );
      if (changedBoardRows.length > 0) persistBoardRankUpserts(changedBoardRows);

      persistRankUpserts(
        siblings.flatMap((s) => {
          const updated = updatedItems[s.id];
          const blId = updated.backlogAssignments[treeId];
          if (!blId) return [];
          const rank = updated.ranks[blId] ?? 0;
          if (state.workItems[s.id]?.ranks[blId] === rank) return [];
          return { workItemId: updated.id, backlogId: blId, rank, organizationId: updated.organizationId ?? orgId };
        }),
      );
      const contextName = parentId ? (state.workItems[parentId]?.title ?? "Unknown Item") : "backlog";
      internalLog({ action: "Sort", entityType: "work_item", entityId: parentId ?? treeId, entityName: contextName, details: logDetails });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    reorderWorkItemInBoard: (workItemId, targetIndex, treeId, backlogIds, statusKey) => {
      const state = get();
      const orgId = state.organizationId!;
      const mainItem = state.workItems[workItemId];
      if (!mainItem) return;
      const columnStatus = (statusKey ?? mainItem.status) as WorkItemStatus;

      const itemsToMoveIds = state.selectedWorkItemIds.includes(workItemId) ? state.selectedWorkItemIds : [workItemId];
      const movingSet = new Set(itemsToMoveIds);
      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));

      // The board column exactly as BoardView draws it: leaf cards of this
      // backlog subtree filed under this column (a status the board has no
      // column for is drawn under Not Started), in the same stable board order
      // over the same Object.values — `targetIndex` is an index into that
      // drawn column. Moving cards from other columns are collected alongside;
      // they are not in the drawn column, so they do not shift the index.
      const columnKeys = new Set(getEffectiveStatuses(backlogIds[0]).map((s) => s.key));
      const columnKey = statusKey ?? boardColumnKey(mainItem.status, columnKeys);
      const isDrawnHere = (wi: WorkItem) => boardColumnKey(wi.status, columnKeys) === columnKey;
      const columnCards = Object.values(state.workItems)
        .filter((wi) => {
          const blId = wi.backlogAssignments[treeId];
          if (!blId || !backlogIdSet.has(blId)) return false;
          if (wi.childrenIds.length > 0) return false;
          return isDrawnHere(wi) || movingSet.has(wi.id);
        })
        .sort(byBoardRank(treeId));

      const remaining = columnCards.filter((c) => !movingSet.has(c.id));
      const drawnColumn = columnCards.filter(isDrawnHere);
      const movingBeforeTarget = drawnColumn.filter((c, i) => movingSet.has(c.id) && i < targetIndex).length;
      const clampedIdx = Math.max(0, Math.min(targetIndex - movingBeforeTarget, remaining.length));
      const movingItems = columnCards.filter((c) => movingSet.has(c.id));
      const newColumn = [...remaining];
      newColumn.splice(clampedIdx, 0, ...movingItems);

      const updatedItems = { ...state.workItems };
      const boardRows: WorkItemBoardRankUpsert[] = [];
      newColumn.forEach((c, i) => {
        const wi = updatedItems[c.id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) return;
        updatedItems[c.id] = {
          ...wi,
          status: movingSet.has(c.id) ? columnStatus : wi.status,
          boardRanks: { ...(wi.boardRanks ?? {}), [blId]: i },
        };
        boardRows.push({ workItemId: c.id, backlogId: blId, rank: i, organizationId: wi.organizationId ?? orgId });
      });
      if (boardRows.length > 0) persistBoardRankUpserts(boardRows);

      // ---- Feed the new column order back into the list ranks --------------
      // Only cards that share a list context (same backlog + same effective
      // parent) and the same status can express this order in the list, so the
      // list positions those cards hold are handed round inside each such
      // group. Everything else in the list stays where it was; its ranks change
      // only where shared ranks must be split (see listRanksFollowingColumn).
      const listGroupOf = (wi: WorkItem): string | null => {
        const blId = wi.backlogAssignments[treeId];
        return blId ? `${blId}::${getEffectiveParentId(wi, treeId) ?? "root"}` : null;
      };
      const columnGroups = new Set(newColumn.flatMap((c) => {
        const key = updatedItems[c.id] ? listGroupOf(updatedItems[c.id]) : null;
        return key ? [key] : [];
      }));
      const groupSiblings = new Map<string, WorkItem[]>();
      for (const wi of Object.values(updatedItems)) {
        const key = listGroupOf(wi);
        if (!key || !columnGroups.has(key)) continue;
        const list = groupSiblings.get(key) ?? [];
        list.push(wi);
        groupSiblings.set(key, list);
      }
      const columnOrder = newColumn.map((c) => c.id);
      const syncedListRanks: Record<string, number> = {};
      // Groups whose order changed are written whole, not just the ranks that
      // changed — as a list drop writes all the siblings. Loading repairs
      // shared ranks in memory only (dedupWorkItemRanksInPlace), so a rank the
      // drop leaves alone may still differ in the database; written alone, the
      // changed ranks could land on it and share it again (seen live).
      const rewrittenGroups: WorkItem[][] = [];
      for (const siblings of groupSiblings.values()) {
        const changed = listRanksFollowingColumn(
          siblings.sort(byRank(treeId)).map((wi) => ({ id: wi.id, rank: wi.ranks[wi.backlogAssignments[treeId]] ?? 0 })),
          columnOrder,
        );
        if (Object.keys(changed).length === 0) continue;
        Object.assign(syncedListRanks, changed);
        rewrittenGroups.push(siblings);
      }
      const touchedParents = new Set<string>();
      for (const [id, rank] of Object.entries(syncedListRanks)) {
        const wi = updatedItems[id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) continue;
        updatedItems[id] = { ...wi, ranks: { ...wi.ranks, [blId]: rank } };
        const parent = getEffectiveParentId(updatedItems[id], treeId);
        if (parent) touchedParents.add(parent);
      }
      const listRows: WorkItemBacklogRankUpsert[] = rewrittenGroups.flat().flatMap((s) => {
        const wi = updatedItems[s.id];
        const blId = wi?.backlogAssignments[treeId];
        const rank = blId ? wi.ranks[blId] : undefined;
        if (!wi || !blId || rank === undefined) return [];
        return [{ workItemId: wi.id, backlogId: blId, rank, organizationId: wi.organizationId ?? orgId }];
      });
      if (listRows.length > 0) persistRankUpserts(listRows);

      // Save the moved cards — only now, with their new list ranks. A work
      // item save writes the item's list ranks as well, after the item row,
      // so it lands after the rank rows above: saved from before the ranks
      // were set, it put the card's old list rank back (seen live: the card
      // then shared a rank with the item that had been given its old one).
      // A card whose status changed is saved for that; a card whose list rank
      // changed is saved again too, because a "board-column" drop has already
      // queued a save from setWorkItemStatus, made with the old rank, and the
      // queue saves in order.
      for (const id of itemsToMoveIds) {
        const before = state.workItems[id];
        const after = updatedItems[id];
        if (!before || !after) continue;
        if (before.status !== after.status || syncedListRanks[id] !== undefined) {
          upsertWorkItem(after, orgId);
        }
      }

      // Keep parents' childrenIds in sync with the new list ranks.
      for (const parentId of touchedParents) {
        const parent = updatedItems[parentId];
        if (!parent) continue;
        const sortedChildren = [...parent.childrenIds].sort((a, b) => {
          const wiA = updatedItems[a];
          const wiB = updatedItems[b];
          if (!wiA || !wiB) return 0;
          const blA = wiA.backlogAssignments[treeId];
          const blB = wiB.backlogAssignments[treeId];
          const rA = blA ? (wiA.ranks[blA] ?? 0) : 0;
          const rB = blB ? (wiB.ranks[blB] ?? 0) : 0;
          return rA !== rB ? rA - rB : a.localeCompare(b);
        });
        updatedItems[parentId] = { ...parent, childrenIds: sortedChildren };
      }

      internalLog({ action: "Board Reorder", entityType: "work_item", entityId: workItemId, entityName: mainItem.title, details: `${itemsToMoveIds.length} items moved` });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },
  };
}
