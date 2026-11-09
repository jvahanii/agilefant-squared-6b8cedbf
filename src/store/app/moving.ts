/**
 * Moving items: to another list or tree, under another item, out of a tree, and
 * copying them with everything under them. Taken out of appStore.ts word for
 * word, but for the paths of the stores a copy's labels, teams and financials
 * are asked of, one folder further up from here.
 */
import { toIsoDate } from "@/lib/deadlineFormat";
import type { Hyperlink, WorkItem, WorkItemStatus } from "@/types/models";
import { getEffectiveParentId } from "@/types/models";
import { upsertWorkItems, deleteWorkItemBacklogRanks, upsertHyperlink, type WorkItemBoardRankUpsert } from "../supabaseSync";
import { getEffectiveStatuses } from "../backlogStatusesStore";
import type { AppState, GetState, LogChange, SetState } from "./types";
import {
  computeNextWorkItemSelection,
  shownBacklogIds,
  ensureCleanId,
  repairOrphanedSurvivors,
  buildCascadedShiftSet,
  addChild,
  removeChild,
  nextRankAmongSiblings,
  moveDescendantsToList,
  spreadMergedSiblingRanks,
} from "./hierarchy";
import { pushUndoEntry } from "./history";
import { persistWorkItemDeletes, persistBoardRankUpserts } from "./writeQueue";

export type MovingActions = Pick<
  AppState,
  | "moveWorkItemToBacklog"
  | "moveWorkItemsToBacklog"
  | "duplicateWorkItems"
  | "removeWorkItemFromTree"
  | "removeWorkItemsFromTreeBulk"
  | "reparentWorkItem"
>;

export function movingActions(set: SetState, get: GetState, internalLog: LogChange): MovingActions {
  return {
    moveWorkItemToBacklog: (workItemId, targetBacklogId, targetTreeId, strategy = "move", sourceTreeId) => {
      get().moveWorkItemsToBacklog([workItemId], targetBacklogId, targetTreeId, strategy, sourceTreeId);
    },

    moveWorkItemsToBacklog: (workItemIds, targetBacklogId, targetTreeId, strategy = "move", sourceTreeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const cleanTargetBl = ensureCleanId(targetBacklogId, orgId);

      const requested = new Set(workItemIds.filter((id) => state.workItems[id]));
      if (requested.size === 0) return;

      // Only move the topmost requested items — descendants follow their root.
      const roots = [...requested].filter((id) => {
        let p = getEffectiveParentId(state.workItems[id], targetTreeId);
        const seen = new Set<string>();
        while (p && !seen.has(p)) {
          if (requested.has(p)) return false;
          seen.add(p);
          const parent = state.workItems[p];
          if (!parent) break;
          p = getEffectiveParentId(parent, targetTreeId);
        }
        return true;
      });
      if (roots.length === 0) return;

      // Preserve the roots' current source-list order in the destination.
      const sourceRankOf = (wi: WorkItem): number => {
        const bl = wi.backlogAssignments[targetTreeId] ?? (sourceTreeId ? wi.backlogAssignments[sourceTreeId] : undefined);
        return bl ? (wi.ranks[bl] ?? 0) : 0;
      };
      roots.sort((a, b) => {
        const diff = sourceRankOf(state.workItems[a]) - sourceRankOf(state.workItems[b]);
        return diff !== 0 ? diff : a.localeCompare(b);
      });
      const rootOrder = new Map(roots.map((id, i) => [id, i]));

      const updatedItems = { ...state.workItems };
      const changed: WorkItem[] = [];
      const changedIndex = new Map<string, number>();
      const pushChanged = (wi: WorkItem) => {
        const idx = changedIndex.get(wi.id);
        if (idx === undefined) {
          changedIndex.set(wi.id, changed.length);
          changed.push(wi);
        } else {
          changed[idx] = wi;
        }
      };
      const removedRanks: Array<{ workItemId: string; backlogId: string }> = [];
      const movedIds = new Set<string>();
      /** Moved items in the destination already — mirrored there — which keep their place in it. */
      const alreadyInDest = new Set<string>();
      /** Previous rank of each moved item, used for stable ordering. */
      const previousRank = new Map<string, number>();

      const destStatuses = getEffectiveStatuses(cleanTargetBl);
      const destStatusKeys = new Set(destStatuses.map((s) => s.key));

      const moveRecursive = (id: string, isRoot: boolean, isCrossTreeMove: boolean) => {
        const wi = updatedItems[id];
        if (!wi) return;
        const oldBlId = wi.backlogAssignments[targetTreeId];
        // Only reassign descendants that actually live in this tree — otherwise
        // we'd add a stray tree assignment to items belonging elsewhere.
        // Exception: on a cross-tree move the root (and its descendants) are new
        // to targetTreeId, so they must be included to gain the tree context.
        if (!isRoot && !oldBlId && !isCrossTreeMove) return;

        const newRanks = { ...wi.ranks };
        const newBoardRanks = { ...(wi.boardRanks ?? {}) };
        previousRank.set(id, oldBlId ? (wi.ranks[oldBlId] ?? 0) : (wi.ranks[cleanTargetBl] ?? 0));
        if (oldBlId === cleanTargetBl) alreadyInDest.add(id);
        if (oldBlId && oldBlId !== cleanTargetBl) {
          delete newRanks[oldBlId];
          delete newBoardRanks[oldBlId];
          removedRanks.push({ workItemId: id, backlogId: oldBlId });
        }
        // Placeholder — final rank is assigned in the placement pass below.
        newRanks[cleanTargetBl] = newRanks[cleanTargetBl] ?? 0;

        const remappedStatus = destStatusKeys.has(wi.status) ? wi.status : ('not_started' as WorkItemStatus);
        updatedItems[id] = {
          ...wi,
          status: remappedStatus,
          backlogAssignments: { ...wi.backlogAssignments, [targetTreeId]: cleanTargetBl },
          ranks: newRanks,
          boardRanks: newBoardRanks,
        };
        movedIds.add(id);
        pushChanged(updatedItems[id]);
        wi.childrenIds.forEach((childId) => moveRecursive(childId, false, isCrossTreeMove));
      };

      const firstRoot = state.workItems[roots[0]];
      for (const rootId of roots) {
        const rootItem = updatedItems[rootId];
        if (!rootItem) continue;
        moveRecursive(rootId, true, !rootItem.backlogAssignments[targetTreeId]);
      }

      // Placement: give the moved items fractional ranks *below* the existing
      // minimum of their destination sibling group.  Pre-existing destination
      // items keep their exact ranks, so nothing else shifts.
      const boardRows: WorkItemBoardRankUpsert[] = [];
      const movedByParent = new Map<string | null, string[]>();
      for (const id of movedIds) {
        if (alreadyInDest.has(id)) continue;
        const pid = getEffectiveParentId(updatedItems[id], targetTreeId) ?? null;
        if (!movedByParent.has(pid)) movedByParent.set(pid, []);
        movedByParent.get(pid)!.push(id);
      }
      const destMinByParent = new Map<string | null, number>();
      for (const wi of Object.values(updatedItems)) {
        if (movedIds.has(wi.id) && !alreadyInDest.has(wi.id)) continue;
        if (wi.backlogAssignments[targetTreeId] !== cleanTargetBl) continue;
        const pid = getEffectiveParentId(wi, targetTreeId) ?? null;
        const r = wi.ranks[cleanTargetBl];
        if (typeof r !== "number") continue;
        const current = destMinByParent.get(pid);
        if (current === undefined || r < current) destMinByParent.set(pid, r);
      }
      for (const [pid, ids] of movedByParent) {
        const ordered = [...ids].sort((a, b) => {
          const oA = rootOrder.get(a);
          const oB = rootOrder.get(b);
          if (oA !== undefined && oB !== undefined) return oA - oB;
          const diff = (previousRank.get(a) ?? 0) - (previousRank.get(b) ?? 0);
          return diff !== 0 ? diff : a.localeCompare(b);
        });
        const destMin = destMinByParent.get(pid);
        const base = destMin === undefined ? 0 : destMin - ordered.length;
        ordered.forEach((id, i) => {
          const wi = updatedItems[id];
          if (!wi) return;
          const rank = base + i;
          updatedItems[id] = {
            ...wi,
            ranks: { ...wi.ranks, [cleanTargetBl]: rank },
            boardRanks: { ...(wi.boardRanks ?? {}), [cleanTargetBl]: rank },
          };
          pushChanged(updatedItems[id]);
          boardRows.push({
            workItemId: id,
            backlogId: cleanTargetBl,
            rank,
            organizationId: wi.organizationId ?? orgId,
          });
        });
      }

      // For cross-tree "move" (not mirror): remove the source tree assignment from
      // all moved items so they no longer appear in the source tree.
      if (strategy === "move" && sourceTreeId && sourceTreeId !== targetTreeId) {
        for (const wi of [...changed]) {
          const sourceBl = wi.backlogAssignments[sourceTreeId];
          if (!sourceBl) continue;
          const newAssignments = { ...wi.backlogAssignments };
          delete newAssignments[sourceTreeId];
          const newRanks = { ...wi.ranks };
          delete newRanks[sourceBl];
          const newBoardRanks = { ...(wi.boardRanks ?? {}) };
          delete newBoardRanks[sourceBl];
          removedRanks.push({ workItemId: wi.id, backlogId: sourceBl });
          const updated = { ...wi, backlogAssignments: newAssignments, ranks: newRanks, boardRanks: newBoardRanks };
          updatedItems[wi.id] = updated;
          pushChanged(updated);
        }
      }

      upsertWorkItems(changed, orgId);
      if (boardRows.length > 0) persistBoardRankUpserts(boardRows);
      // Clean up stale rank rows in the DB for backlogs that items were moved out of.
      deleteWorkItemBacklogRanks(removedRanks);

      const oldBacklogId = firstRoot?.backlogAssignments[targetTreeId];
      const oldBacklogName = oldBacklogId ? state.backlogs[oldBacklogId]?.name : '?';
      const newBacklogName = state.backlogs[cleanTargetBl]?.name ?? cleanTargetBl;
      internalLog({
        action: "Move to List",
        entityType: "work_item",
        entityId: roots[0],
        entityName: roots.length === 1 ? (firstRoot?.title ?? roots[0]) : `${roots.length} items`,
        details: `list: "${oldBacklogName}" → "${newBacklogName}"`,
      });
      // A move that takes the selected item off screen leaves the selection
      // where the eye already is: the row below it, or the one above when it
      // was last. A mirror leaves the item in place, so it keeps its selection,
      // and so does a move within the backlogs on screen.
      const selectionAfterMove = (() => {
        if (strategy === "mirror") return null;
        if (!state.selectedWorkItemIds.some((id) => movedIds.has(id))) return null;
        const staysOnScreen =
          targetTreeId === state.selectedTreeId &&
          shownBacklogIds(state.backlogs, state.selectedBacklogIds).has(cleanTargetBl);
        if (staysOnScreen) return null;
        const next = computeNextWorkItemSelection(movedIds, "down");
        return next ? [next] : [];
      })();

      set({
        workItems: updatedItems,
        ...(selectionAfterMove ? { selectedWorkItemIds: selectionAfterMove } : {}),
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    duplicateWorkItems: (workItemIds) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || workItemIds.length === 0) return [];

      // Keep only top-level items in the selection — if both an ancestor and a
      // descendant are selected, the descendant will be duplicated as part of
      // the ancestor's subtree, so skip it as an explicit root.
      const idsSet = new Set(workItemIds);
      const roots = workItemIds.filter((id) => {
        const wi = state.workItems[id];
        if (!wi) return false;
        let p = wi.parentId;
        while (p) {
          if (idsSet.has(p)) return false;
          p = state.workItems[p]?.parentId ?? null;
        }
        return true;
      });
      if (roots.length === 0) return [];

      const updatedWorkItems = { ...state.workItems };
      const updatedHyperlinks = { ...state.hyperlinks };
      const itemsToUpdateInDB: WorkItem[] = [];
      const newHyperlinksToUpsert: { link: Hyperlink; itemOrgId?: string }[] = [];
      const oldToNew = new Map<string, string>();
      const newRootIds: string[] = [];

      const cloneSubtree = (oldId: string, newParentId: string | null): string | null => {
        const src = updatedWorkItems[oldId];
        if (!src) return null;
        const newId = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
        oldToNew.set(oldId, newId);

        const copy: WorkItem = {
          id: newId,
          title: src.title,
          description: src.description,
          points: src.points,
          rating: src.rating,
          deadline: src.deadline,
          // A copy is made today, whenever its original was.
          createdOn: toIsoDate(new Date()),
          status: src.status,
          parentId: newParentId,
          // Drop per-tree parent overrides on the clone — they reference the
          // source's tree-context which doesn't apply to the new item.
          parentIds: undefined,
          childrenIds: [],
          backlogAssignments: { ...src.backlogAssignments },
          ranks: { ...src.ranks },
          organizationId: src.organizationId,
          respawnEnabled: src.respawnEnabled,
          respawnIntervalDays: src.respawnIntervalDays,
          respawnHour: src.respawnHour,
          respawnMinute: src.respawnMinute,
          // Don't carry over last-triggered timestamp — the clone is a fresh item.
          respawnLastTriggeredAt: undefined,
        };
        updatedWorkItems[newId] = copy;

        // Clone children (using source's childrenIds — pre-clone snapshot).
        const sourceChildIds = [...src.childrenIds];
        for (const childOldId of sourceChildIds) {
          if (!updatedWorkItems[childOldId]) continue;
          const newChildId = cloneSubtree(childOldId, newId);
          if (newChildId) {
            updatedWorkItems[newId] = {
              ...updatedWorkItems[newId],
              childrenIds: [...updatedWorkItems[newId].childrenIds, newChildId],
            };
          }
        }

        itemsToUpdateInDB.push(updatedWorkItems[newId]);

        // Copy hyperlinks.
        const links = state.hyperlinks[oldId];
        if (links && links.length > 0) {
          const newLinks: Hyperlink[] = links.map((l) => ({
            id: crypto.randomUUID(),
            workItemId: newId,
            url: l.url,
            altText: l.altText,
            rank: l.rank,
          }));
          updatedHyperlinks[newId] = newLinks;
          newLinks.forEach((nl) => newHyperlinksToUpsert.push({ link: nl, itemOrgId: src.organizationId }));
        }

        return newId;
      };

      for (const rootId of roots) {
        const orig = updatedWorkItems[rootId];
        if (!orig) continue;

        // Shift later siblings in every backlog the original is in to make room
        // for the clone at (originalRank + 1).
        const copyRanks: Record<string, number> = {};
        for (const [, blId] of Object.entries(orig.backlogAssignments)) {
          const insertRank = (orig.ranks[blId] ?? 0) + 1;
          copyRanks[blId] = insertRank;
          const toShift = buildCascadedShiftSet(updatedWorkItems, orig.parentId, insertRank, rootId, blId);
          toShift.forEach((sid) => {
            const wi = updatedWorkItems[sid];
            const shifted = { ...wi, ranks: { ...wi.ranks, [blId]: (wi.ranks[blId] ?? 0) + 1 } };
            updatedWorkItems[sid] = shifted;
            itemsToUpdateInDB.push(shifted);
          });
        }

        const newRootId = cloneSubtree(rootId, orig.parentId);
        if (!newRootId) continue;

        // Override the cloned root's ranks with the computed insert ranks.
        updatedWorkItems[newRootId] = { ...updatedWorkItems[newRootId], ranks: copyRanks };
        const idx = itemsToUpdateInDB.findIndex((wi) => wi.id === newRootId);
        if (idx !== -1) itemsToUpdateInDB[idx] = updatedWorkItems[newRootId];

        newRootIds.push(newRootId);

        if (orig.parentId && updatedWorkItems[orig.parentId]) {
          updatedWorkItems[orig.parentId] = {
            ...updatedWorkItems[orig.parentId],
            childrenIds: [...updatedWorkItems[orig.parentId].childrenIds, newRootId],
          };
        }
      }

      upsertWorkItems(itemsToUpdateInDB, orgId);
      newHyperlinksToUpsert.forEach(({ link, itemOrgId }) => upsertHyperlink(link, orgId, itemOrgId));

      internalLog({
        action: "Duplicate",
        entityType: "work_item",
        entityId: newRootIds[0],
        entityName: state.workItems[roots[0]]?.title,
        details: `${roots.length} root(s), ${oldToNew.size} total`,
      });

      set({
        workItems: updatedWorkItems,
        hyperlinks: updatedHyperlinks,
        selectedWorkItemIds: newRootIds,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });

      // Asynchronously copy labels / team assignments / financials from each
      // source item to its clone via the respective stores (dynamic imports
      // avoid circular deps).
      void import("../labelsStore").then(({ useLabelsStore }) => {
        const ls = useLabelsStore.getState();
        oldToNew.forEach((newId, oldId) => {
          const labelIds = ls.byEntity[`work_item:${oldId}`] ?? [];
          labelIds.forEach((lid) => {
            const label = ls.labels[lid];
            if (label) ls.assignLabel(lid, "work_item", newId, label.organizationId);
          });
        });
      });
      void import("../teamStore").then(({ useTeamStore }) => {
        const ts = useTeamStore.getState();
        oldToNew.forEach((newId, oldId) => {
          const teamIds = ts.workItemTeams[oldId] ?? [];
          teamIds.forEach((tid) => {
            const team = ts.teams.find((t) => t.id === tid);
            const teamOrgId = (team as unknown as { organization_id?: string } | undefined)?.organization_id;
            const itemOrgId = updatedWorkItems[newId]?.organizationId ?? orgId;
            ts.assignTeamToWorkItem(newId, tid, teamOrgId || itemOrgId);
          });
        });
      });
      void import("../financialsStore").then(({ useFinancialsStore }) => {
        const fs = useFinancialsStore.getState();
        oldToNew.forEach((newId, oldId) => {
          const entry = fs.byWorkItem[oldId];
          if (!entry) return;
          const itemOrgId = updatedWorkItems[newId]?.organizationId ?? orgId;
          fs.upsert(newId, itemOrgId, {
            savingsByMonth: { ...entry.savingsByMonth },
            incomeByMonth: { ...entry.incomeByMonth },
            actualSavingsByMonth: { ...entry.actualSavingsByMonth },
            actualIncomeByMonth: { ...entry.actualIncomeByMonth },
            currency: entry.currency,
          });
        });
      });

      return newRootIds;
    },

    removeWorkItemFromTree: (workItemId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;

      const updatedItems = { ...state.workItems };
      const toUpsert: WorkItem[] = [];
      const idsToDelete: string[] = [];

      const processItem = (id: string) => {
        const wi = updatedItems[id];
        if (!wi) return;
        const newAssignments = { ...wi.backlogAssignments };
        const removedBlId = newAssignments[treeId];
        delete newAssignments[treeId];
        if (Object.keys(newAssignments).length === 0) {
          // No remaining tree assignments: delete this item, but recurse into
          // children via processItem instead of blindly collecting the whole
          // subtree — children that still have assignments in other trees must
          // be preserved and reparented rather than deleted.
          idsToDelete.push(id);
          wi.childrenIds.forEach(processItem);
        } else {
          const newRanks = { ...wi.ranks };
          if (removedBlId) delete newRanks[removedBlId];
          updatedItems[id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
          toUpsert.push(updatedItems[id]);
          updatedItems[id].childrenIds.forEach(processItem);
        }
      };

      processItem(workItemId);

      if (idsToDelete.length > 0) {
        const deleteSet = new Set(idsToDelete);
        idsToDelete.forEach((deletedId) => {
          const deletedItem = state.workItems[deletedId];
          if (deletedItem?.parentId && !deleteSet.has(deletedItem.parentId) && updatedItems[deletedItem.parentId]) {
            updatedItems[deletedItem.parentId] = {
              ...updatedItems[deletedItem.parentId],
              childrenIds: updatedItems[deletedItem.parentId].childrenIds.filter((id) => id !== deletedId),
            };
          }
          delete updatedItems[deletedId];
        });

        // Reparent orphaned survivors: kept items whose immediate parent was
        // deleted (because it had no remaining assignments).  Walk up the
        // original ancestor chain to find the nearest surviving ancestor.
        repairOrphanedSurvivors(updatedItems, deleteSet, state.workItems, (updated) => {
          toUpsert.push(updated);
        });

        persistWorkItemDeletes(idsToDelete)?.catch((err) => console.error("Delete work item failed", err));
      }
      if (toUpsert.length > 0) {
        upsertWorkItems(toUpsert, orgId);
      }

      const treeName = state.backlogTrees[treeId]?.name ?? treeId;
      internalLog({ action: "Remove from Tree", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `tree: "${treeName}"` });
      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    removeWorkItemsFromTreeBulk: (items) => {
      const state = get();
      const orgId = state.organizationId!;
      if (items.length === 0) return;

      const updatedItems = { ...state.workItems };
      const toUpsert: WorkItem[] = [];
      const allIdsToDelete: string[] = [];
      // Ids that leave the tree on screen, so the selection can follow them
      // the way it follows a move or a delete.
      const leftTheShownTree = new Set<string>();

      for (const { workItemId, treeId } of items) {
        if (!state.workItems[workItemId]) continue;

        const processItem = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          if (treeId === state.selectedTreeId) leftTheShownTree.add(id);
          const newAssignments = { ...wi.backlogAssignments };
          const removedBlId = newAssignments[treeId];
          delete newAssignments[treeId];
          if (Object.keys(newAssignments).length === 0) {
            allIdsToDelete.push(id);
            wi.childrenIds.forEach(processItem);
          } else {
            const newRanks = { ...wi.ranks };
            if (removedBlId) delete newRanks[removedBlId];
            updatedItems[id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
            toUpsert.push(updatedItems[id]);
            updatedItems[id].childrenIds.forEach(processItem);
          }
        };

        processItem(workItemId);
      }

      if (allIdsToDelete.length > 0) {
        const deleteSet = new Set(allIdsToDelete);
        allIdsToDelete.forEach((deletedId) => {
          const deletedItem = state.workItems[deletedId];
          if (deletedItem?.parentId && !deleteSet.has(deletedItem.parentId) && updatedItems[deletedItem.parentId]) {
            updatedItems[deletedItem.parentId] = {
              ...updatedItems[deletedItem.parentId],
              childrenIds: updatedItems[deletedItem.parentId].childrenIds.filter((id) => !deleteSet.has(id)),
            };
          }
          delete updatedItems[deletedId];
        });

        repairOrphanedSurvivors(updatedItems, deleteSet, state.workItems, (updated) => {
          toUpsert.push(updated);
        });

        persistWorkItemDeletes(allIdsToDelete)?.catch((err) => console.error("Bulk remove from tree failed", err));
      }
      if (toUpsert.length > 0) {
        upsertWorkItems(toUpsert, orgId);
      }

      internalLog({ action: "Remove from Tree", entityType: "work_item", entityId: items[0].workItemId, entityName: `${items.length} items` });

      // As with a move: the selection lands on the row below what left, or
      // the one above when it was last.
      const nextSelected = state.selectedWorkItemIds.some((id) => leftTheShownTree.has(id))
        ? computeNextWorkItemSelection(leftTheShownTree, "down")
        : undefined;

      set({
        workItems: updatedItems,
        ...(nextSelected === undefined ? {} : { selectedWorkItemIds: nextSelected ? [nextSelected] : [] }),
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    reparentWorkItem: (workItemId, newParentId, treeId, backlogId, strategy, rank) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updatedItems = { ...state.workItems };

      // IDs of descendants that were migrated (for DB upsert in move-to-tree).
      const changedDescendantIds: string[] = [];
      // Siblings moved down a place to make room (an outdent), saved with the rest.
      const shiftedSiblingIds: string[] = [];

      // Whether the item lives in more than one tree — drives whether we use a
      // global or per-tree parent change.
      const isMultiTree = Object.keys(item.backlogAssignments).length > 1;

      if (strategy === "move-to-tree" && treeId && backlogId) {
        // Move item + entire subtree to the new tree's backlog, removing all old
        // tree assignments.  Because the item becomes single-tree, it is safe to
        // update the global parentId; also clear any per-tree overrides.
        const cleanBlId = ensureCleanId(backlogId, orgId);

        // Remove from old global parent's childrenIds
        if (item.parentId && updatedItems[item.parentId]) removeChild(updatedItems, item.parentId, workItemId);
        // Also remove from any per-tree parent entries that differ from global
        if (item.parentIds) {
          for (const treeParentId of Object.values(item.parentIds)) {
            if (treeParentId && treeParentId !== item.parentId && updatedItems[treeParentId]) removeChild(updatedItems, treeParentId, workItemId);
          }
        }
        // Add to new parent
        addChild(updatedItems, newParentId, workItemId);

        // Compute rank for the root item as max+1 among siblings in the new backlog.
        const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, cleanBlId!);

        updatedItems[workItemId] = {
          ...item,
          parentId: newParentId,
          parentIds: {},
          backlogAssignments: { [treeId]: cleanBlId },
          ranks: { [cleanBlId]: nextRank },
        };

        // Recursively migrate all descendants: replace all tree assignments with
        // { treeId: cleanBlId }, preserving relative rank order.
        const migrateDescendants = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          // Use the first available rank as a hint to preserve relative ordering.
          const oldRank = Object.values(wi.ranks)[0] ?? 0;
          updatedItems[id] = {
            ...wi,
            parentIds: {},
            backlogAssignments: { [treeId]: cleanBlId },
            ranks: { [cleanBlId]: oldRank },
          };
          changedDescendantIds.push(id);
          wi.childrenIds.forEach(migrateDescendants);
        };
        item.childrenIds.forEach(migrateDescendants);

        // Siblings that came from different lists may now clash: spread them.
        spreadMergedSiblingRanks(updatedItems, changedDescendantIds, cleanBlId, (wi) => wi.parentId ?? null);
      } else if (strategy === "mirror" && treeId && backlogId) {
        // Add the new tree assignment while keeping all existing ones.
        // DON'T change the global parentId — store the new parent as a per-tree
        // override so existing tree relationships are undisturbed.
        const cleanBlId = ensureCleanId(backlogId, orgId);

        // Add to new parent's childrenIds only (leave old parent's list intact).
        addChild(updatedItems, newParentId, workItemId);

        // Compute rank in the new backlog context.
        const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, cleanBlId!);

        updatedItems[workItemId] = {
          ...item,
          parentIds: { ...item.parentIds, [treeId]: newParentId },
          backlogAssignments: { ...item.backlogAssignments, [treeId]: cleanBlId },
          ranks: { ...item.ranks, [cleanBlId]: nextRank },
        };
      } else {
        // Same-tree reparent (no cross-tree strategy).
        const cleanBlId = treeId && backlogId ? ensureCleanId(backlogId, orgId) : null;
        const currentBlId = treeId ? item.backlogAssignments[treeId] : null;
        const isBacklogChange = cleanBlId !== null && treeId !== undefined && currentBlId !== null && currentBlId !== cleanBlId;

        // Effective parent of this item in the tree being operated on (before update).
        const oldEffectiveParentId = treeId ? getEffectiveParentId(item, treeId) : item.parentId;

        if (isMultiTree && treeId) {
          // Multi-tree item: only change the parent relationship for this specific
          // tree to avoid inadvertently changing it in all other trees.

          // Only remove item from the old effective parent's childrenIds when that
          // parent is no longer referenced by any other tree on this item.
          const isOldParentStillNeeded = Object.keys(item.backlogAssignments)
            .filter((tid) => tid !== treeId)
            .some((tid) => getEffectiveParentId(item, tid) === oldEffectiveParentId);

          if (!isOldParentStillNeeded && oldEffectiveParentId && updatedItems[oldEffectiveParentId]) removeChild(updatedItems, oldEffectiveParentId, workItemId);
          addChild(updatedItems, newParentId, workItemId);

          if (isBacklogChange) {
            // Same-tree reparent into a different backlog: migrate the item and all
            // its descendants to the new backlog, replacing the old assignment for
            // this tree (same logic as move-to-tree but scoped to one tree).
            const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, cleanBlId!);

            const newRanks = { ...item.ranks };
            delete newRanks[currentBlId!];
            newRanks[cleanBlId!] = nextRank;
            updatedItems[workItemId] = {
              ...item,
              parentIds: { ...item.parentIds, [treeId]: newParentId },
              backlogAssignments: { ...item.backlogAssignments, [treeId]: cleanBlId! },
              ranks: newRanks,
            };

            // Its descendants go with it, in this tree only, keeping their ranks —
            // spread where siblings from different lists now clash.
            changedDescendantIds.push(...moveDescendantsToList(updatedItems, item.childrenIds, treeId, cleanBlId!));
            spreadMergedSiblingRanks(updatedItems, changedDescendantIds, cleanBlId!, (wi) => getEffectiveParentId(wi, treeId));
          } else {
            // Same-tree, same-backlog reparent for a multi-tree item: only update
            // the rank for the current tree's backlog (avoid touching other trees).
            const blId = item.backlogAssignments[treeId] ?? null;
            const newRanks = { ...item.ranks };
            if (blId) {
              const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, blId);
              newRanks[blId] = nextRank;
            }
            updatedItems[workItemId] = {
              ...item,
              parentIds: { ...item.parentIds, [treeId]: newParentId },
              ranks: newRanks,
            };
          }
        } else {
          // Single-tree item (or no treeId context): update the global parentId as
          // before.  This preserves unchanged behaviour for the common case.

          // Determine the true old parent in this tree, honoring per-tree overrides.
          const singleTreeOldParentId = treeId
            ? getEffectiveParentId(item, treeId)
            : item.parentId;

          // Remove from old parent (effective, not just global)
          if (singleTreeOldParentId && updatedItems[singleTreeOldParentId]) removeChild(updatedItems, singleTreeOldParentId, workItemId);
          // Add to new parent
          addChild(updatedItems, newParentId, workItemId);

          // If a treeId was provided, clear any stale per-tree parent override for
          // it so the new global parentId is honored in that tree. Without this,
          // an existing override silently keeps pointing at the old parent and the
          // reparent appears to do nothing in the UI.
          const clearedParentIds = (() => {
            if (!treeId || !item.parentIds || !(treeId in item.parentIds)) {
              return item.parentIds;
            }
            const next = { ...item.parentIds };
            delete next[treeId];
            return next;
          })();

          if (isBacklogChange) {
            // Same-tree reparent into a different backlog: migrate the item and all
            // its descendants to the new backlog, replacing the old assignment for
            // this tree (same logic as move-to-tree but scoped to one tree).
            const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId!, cleanBlId!);

            const newRanks = { ...item.ranks };
            delete newRanks[currentBlId!];
            newRanks[cleanBlId!] = nextRank;
            updatedItems[workItemId] = {
              ...item,
              parentId: newParentId,
              parentIds: clearedParentIds,
              backlogAssignments: { ...item.backlogAssignments, [treeId!]: cleanBlId! },
              ranks: newRanks,
            };

            // Its descendants go with it, in this tree only, keeping their ranks —
            // spread where siblings from different lists now clash.
            changedDescendantIds.push(...moveDescendantsToList(updatedItems, item.childrenIds, treeId!, cleanBlId!));
            spreadMergedSiblingRanks(updatedItems, changedDescendantIds, cleanBlId!, (wi) => getEffectiveParentId(wi, treeId!));
          } else {
            // Same-tree, same-backlog reparent: assign a rank that avoids conflicts
            // with existing siblings in the new parent's context for every backlog
            // the item belongs to.
            // When rank is provided (e.g. from the outdent handler), insert the item
            // at that specific position and cascade-shift later siblings.
            const newRanks = { ...item.ranks };
            if (rank !== undefined) {
              for (const [tId, blId] of Object.entries(item.backlogAssignments)) {
                const toShift = buildCascadedShiftSet(
                  updatedItems, newParentId, rank, workItemId, blId, tId,
                );
                toShift.forEach((sid) => {
                  const sWi = updatedItems[sid];
                  const shifted = { ...sWi, ranks: { ...sWi.ranks, [blId]: (sWi.ranks[blId] ?? 0) + 1 } };
                  updatedItems[sid] = shifted;
                  shiftedSiblingIds.push(sid);
                });
                newRanks[blId] = rank;
              }
            } else {
              for (const [tId, blId] of Object.entries(item.backlogAssignments)) {
                const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, tId, blId);
                newRanks[blId] = nextRank;
              }
            }
            updatedItems[workItemId] = { ...item, parentId: newParentId, parentIds: clearedParentIds, ranks: newRanks };
          }
        }
      }

      // Collect all items that need to be persisted to the DB.
      const changed = [updatedItems[workItemId]];
      const modifiedParentIds = new Set<string>();
      if (item.parentId) modifiedParentIds.add(item.parentId);
      if (item.parentIds) { for (const pid of Object.values(item.parentIds)) { if (pid) modifiedParentIds.add(pid); } }
      if (newParentId) modifiedParentIds.add(newParentId);
      for (const pid of modifiedParentIds) {
        if (updatedItems[pid]) changed.push(updatedItems[pid]);
      }
      for (const id of changedDescendantIds) {
        if (updatedItems[id]) changed.push(updatedItems[id]);
      }
      for (const id of new Set(shiftedSiblingIds)) {
        if (updatedItems[id] && !changed.includes(updatedItems[id])) changed.push(updatedItems[id]);
      }
      upsertWorkItems(changed, orgId);
      const oldEffectiveParentIdForLog = treeId ? getEffectiveParentId(item, treeId) : item.parentId;
      const oldParentName = oldEffectiveParentIdForLog ? (state.workItems[oldEffectiveParentIdForLog]?.title ?? oldEffectiveParentIdForLog) : "none";
      const newParentName = newParentId ? (state.workItems[newParentId]?.title ?? newParentId) : "none";
      const strategyLabel = strategy === "move-to-tree" ? " (move to tree)" : strategy === "mirror" ? " (mirror)" : "";
      internalLog({ action: "Reparent", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `parent: "${oldParentName}" → "${newParentName}"${strategyLabel}` });
      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },
  };
}
