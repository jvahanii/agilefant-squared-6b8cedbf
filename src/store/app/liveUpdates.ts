/**
 * Changes made elsewhere — by another person, another device, an import —
 * arriving over the realtime channel, row by row, and put into the store. The
 * echo of this page's own saves comes back the same way; it changes nothing,
 * and must not redraw anything either.
 *
 * What does change is made in the undo and redo copies too (rebaseUndo), so
 * that undo takes back only what was done on this page.
 */
import type { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink } from "@/types/models";
import { isRecentlyDeletedWorkItem } from "../deletedWorkItems";
import { noteItemChanged } from "@/lib/itemChangedAt";
import type { AppState, GetState, SetState } from "./types";
import { rebaseUndoHistory } from "./rebaseUndo";
import { suppressLocalRankEcho, suppressLocalBoardRankEcho } from "./rankEchoes";
import { samePersistedWorkItem } from "./samePersistedWorkItem";

export type LiveUpdateActions = Pick<
  AppState,
  | "applyRealtimeWorkItem"
  | "applyRealtimeWorkItemRank"
  | "applyRealtimeWorkItemBoardRank"
  | "applyRealtimeBacklog"
  | "applyRealtimeBacklogTree"
  | "applyRealtimeHyperlink"
>;

export function liveUpdateActions(set: SetState, get: GetState): LiveUpdateActions {
  /** Puts a change from elsewhere into the store, and into the undo and redo copies. */
  const applyRemote = (change: (state: AppState) => AppState | Partial<AppState>) => {
    const before = get();
    set(change);
    const after = get();
    if (after !== before) rebaseUndoHistory(before, after);
  };

  // Debounce childrenIds re-sort from realtime rank events so batch
  // reorders don't cause visible jump-then-correct flickering.
  const pendingRankResorts = new Map<string, { parentId: string; treeId: string }>();
  let rankResortScheduled = false;
  const flushRankResorts = () => {
    rankResortScheduled = false;
    if (pendingRankResorts.size === 0) return;
    const toProcess = new Map(pendingRankResorts);
    pendingRankResorts.clear();
    applyRemote((state) => {
      const updatedItems = { ...state.workItems };
      let changed = false;
      for (const [, { parentId, treeId }] of toProcess) {
        const parent = updatedItems[parentId];
        if (!parent) continue;
        const sortedIds = [...parent.childrenIds].sort((a, b) => {
          const wiA = updatedItems[a];
          const wiB = updatedItems[b];
          const blA = wiA?.backlogAssignments[treeId];
          const blB = wiB?.backlogAssignments[treeId];
          const rA = wiA && blA ? (wiA.ranks[blA] ?? 0) : 0;
          const rB = wiB && blB ? (wiB.ranks[blB] ?? 0) : 0;
          return rA - rB;
        });
        updatedItems[parentId] = { ...parent, childrenIds: sortedIds };
        changed = true;
      }
      return changed ? { workItems: updatedItems } : state;
    });
  };

  return {
    applyRealtimeWorkItem: (eventType, row) => {
      // Before anything decides the update changes nothing: the search goes by it.
      if (eventType !== 'DELETE') noteItemChanged(row.id as string, row.changed_at);
      applyRemote((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.workItems[id]) return state;
          const oldItem = state.workItems[id];
          const updatedWorkItems = { ...state.workItems };
          delete updatedWorkItems[id];
          if (oldItem.parentId && updatedWorkItems[oldItem.parentId]) {
            updatedWorkItems[oldItem.parentId] = {
              ...updatedWorkItems[oldItem.parentId],
              childrenIds: updatedWorkItems[oldItem.parentId].childrenIds.filter((cid) => cid !== id),
            };
          }
          // Fix orphaned children in local state: items whose parentId points to
          // the just-deleted item but were not deleted themselves (e.g. due to a
          // data inconsistency).  Promote them to the deleted item's parent so
          // they don't appear as unexpected roots in other trees.
          const newParentForOrphans = oldItem.parentId ?? null;
          for (const wi of Object.values(updatedWorkItems)) {
            if (wi.parentId !== id) continue;
            updatedWorkItems[wi.id] = { ...wi, parentId: newParentForOrphans };
            if (newParentForOrphans && updatedWorkItems[newParentForOrphans]) {
              const gp = updatedWorkItems[newParentForOrphans];
              if (!gp.childrenIds.includes(wi.id)) {
                updatedWorkItems[newParentForOrphans] = {
                  ...gp,
                  childrenIds: [...gp.childrenIds, wi.id],
                };
              }
            }
          }
          return { workItems: updatedWorkItems };
        }

        // The echo of a save made before this page deleted the item, arriving
        // after. Showing it again would let the next edit save it again.
        if (!state.workItems[id] && isRecentlyDeletedWorkItem(id)) return state;


        // INSERT or UPDATE: preserve existing childrenIds and ranks from current state.
        // Ranks live in the separate work_item_backlog_ranks table and arrive
        // via applyRealtimeWorkItemRank; we keep the existing local ranks here.
        const rawAssignments = row.backlog_assignments as Record<string, unknown> | null;
        const parsedAssignments: Record<string, string> = {};
        if (rawAssignments && typeof rawAssignments === 'object') {
          for (const [tId, value] of Object.entries(rawAssignments)) {
            if (typeof value === 'string') {
              parsedAssignments[tId] = value;
            } else if (value && typeof value === 'object' && 'backlogId' in value) {
              // Legacy enriched format – extract plain backlogId
              parsedAssignments[tId] = (value as { backlogId: string }).backlogId;
            }
          }
        }
        // If the realtime payload did not include backlog_assignments at all
        // (missing key, null, or empty object), preserve the existing local
        // assignments so a partial UPDATE never silently wipes them.  Without
        // this guard, an external event like a status change arriving without
        // the backlog_assignments column would orphan the item.
        //
        // Also, when the payload DOES include backlog_assignments but is a
        // SUBSET of the local assignments (e.g. another client changed a
        // single tree assignment), MERGE with the local state so multi-tree
        // items don't vanish from the trees that weren't mentioned in the
        // realtime event.
        const existingAssignments = state.workItems[id]?.backlogAssignments ?? {};
        let effectiveAssignments: Record<string, string>;
        if (Object.keys(parsedAssignments).length > 0) {
          // Merge: locally-known trees not in the payload are preserved.
          effectiveAssignments = { ...existingAssignments, ...parsedAssignments };
          // If a tree IS in the payload but its value is missing/null/empty, remove it.
          for (const tId of Object.keys(effectiveAssignments)) {
            if (!effectiveAssignments[tId]) delete effectiveAssignments[tId];
          }
        } else {
          effectiveAssignments = existingAssignments;
        }

        // Seed initial ranks from the legacy work_items.rank column for new
        // INSERT events. This ensures items inserted by external sources (e.g.
        // the GitHub PR webhook) appear at the correct position immediately,
        // before the separate work_item_backlog_ranks realtime event arrives.
        const existingRanks = state.workItems[id]?.ranks ?? {};
        let initialRanks: Record<string, number> = existingRanks;
        if (eventType === 'INSERT' && Object.keys(existingRanks).length === 0) {
          const legacyRank = typeof row.rank === 'number' ? (row.rank as number) : null;
          if (legacyRank !== null) {
            const seeded: Record<string, number> = {};
            for (const blId of Object.values(parsedAssignments)) {
              seeded[blId] = legacyRank;
            }
            if (Object.keys(seeded).length > 0) initialRanks = seeded;
          }
        }

        // Parse parent_id_overrides if present in the payload; otherwise
        // preserve whatever the current local state already knows.  Without
        // this preservation, any realtime UPDATE silently strips per-tree
        // parent overrides and items collapse to the root level.
        let parsedParentIds: Record<string, string | null> | undefined;
        if ('parent_id_overrides' in row) {
          const raw = row.parent_id_overrides as unknown;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const map: Record<string, string | null> = {};
            for (const [tId, val] of Object.entries(raw as Record<string, unknown>)) {
              if (val === null || typeof val === 'string') map[tId] = val as string | null;
            }
            parsedParentIds = Object.keys(map).length > 0 ? map : undefined;
          } else {
            parsedParentIds = undefined;
          }
        } else {
          parsedParentIds = state.workItems[id]?.parentIds;
        }

        const newItem: WorkItem = {
          id,
          title: row.title as string,
          description: (row.description as string | null) ?? undefined,
          points: (row.points as number | null) ?? undefined,
          // Without this the echo of a rating's own save rebuilt the item
          // without it, and the stars just clicked went out again.
          rating: (row.rating as number | null) ?? undefined,
          // The same for a deadline: left out here, the echo of setting one
          // would clear it a moment later, as it did for stars before.
          deadline: (row.deadline as string | null) ?? undefined,
          // And for the created date — falling back on what is held here, so
          // an echo that does not carry the column cannot blank it.
          createdOn: (row.created_on as string | null) ?? state.workItems[id]?.createdOn,
          // Start and end dates can be removed, so a null in the row means
          // none — but a row that does not carry the columns says nothing, and
          // what is held here stands.
          startedOn: 'started_on' in row ? ((row.started_on as string | null) ?? undefined) : state.workItems[id]?.startedOn,
          endedOn: 'ended_on' in row ? ((row.ended_on as string | null) ?? undefined) : state.workItems[id]?.endedOn,
          status: ((row.status as string) ?? 'not_started') as WorkItemStatus,
          parentId: (row.parent_id as string | null) ?? null,
          parentIds: parsedParentIds,
          childrenIds: state.workItems[id]?.childrenIds ?? [],
          backlogAssignments: effectiveAssignments,
          ranks: initialRanks,
          boardRanks: state.workItems[id]?.boardRanks ?? {},
          organizationId: (row.organization_id as string) ?? undefined,
          respawnEnabled: (row.respawn_enabled as boolean) ?? false,
          respawnIntervalDays: (row.respawn_interval_days as number | null) ?? undefined,
          respawnHour: (row.respawn_hour as number | null) ?? undefined,
          respawnMinute: (row.respawn_minute as number | null) ?? undefined,
          respawnLastTriggeredAt: (row.respawn_last_triggered_at as string | null) ?? undefined,
          changedAt: (row.changed_at as string | null) ?? state.workItems[id]?.changedAt,
        };

        // The echo of this page's own save — every item of a move sends one —
        // says what the item already is here. Applied, each copied the whole
        // map of items and re-rendered every view of them: a hundred items
        // moved into a long list took seconds of this, one echo after another.
        if (state.workItems[id] && samePersistedWorkItem(state.workItems[id], newItem)) return state;

        const updatedWorkItems = { ...state.workItems, [id]: newItem };

        const oldItem = state.workItems[id];
        const oldParentId = oldItem?.parentId ?? null;

        if (eventType === 'INSERT' || oldParentId !== newItem.parentId) {
          // Remove from old parent (UPDATE reparent case)
          if (oldParentId && oldParentId !== newItem.parentId && updatedWorkItems[oldParentId]) {
            updatedWorkItems[oldParentId] = {
              ...updatedWorkItems[oldParentId],
              childrenIds: updatedWorkItems[oldParentId].childrenIds.filter((cid) => cid !== id),
            };
          }
          // Add to new parent if not already there (DO NOT sort — per-tree
          // rank order is maintained exclusively by local reorder actions
          // and applyRealtimeWorkItemRank/flushRankResorts; sorting here
          // with a non-tree-aware comparator causes bounceback creep).
          if (newItem.parentId && updatedWorkItems[newItem.parentId]) {
            const parent = updatedWorkItems[newItem.parentId];
            if (!parent.childrenIds.includes(id)) {
              updatedWorkItems[newItem.parentId] = { ...parent, childrenIds: [...parent.childrenIds, id] };
            }
          }
        }
        // Same parent: no-op — childrenIds order is maintained by the
        // local reorder actions and applyRealtimeWorkItemRank/flushRankResorts.
        // Re-sorting here with min-rank-across-all-backlogs would corrupt
        // the per-tree ordering for multi-backlog items.

        // Sync childrenIds for per-tree override parents.  Remove from any
        // override parent that no longer references this item, and add to any
        // new override parent.
        const oldOverrideParents = new Set<string>();
        if (oldItem?.parentIds) {
          for (const pid of Object.values(oldItem.parentIds)) {
            if (pid && pid !== oldParentId) oldOverrideParents.add(pid);
          }
        }
        const newOverrideParents = new Set<string>();
        if (newItem.parentIds) {
          for (const pid of Object.values(newItem.parentIds)) {
            if (pid && pid !== newItem.parentId) newOverrideParents.add(pid);
          }
        }
        for (const pid of oldOverrideParents) {
          if (newOverrideParents.has(pid)) continue;
          const parent = updatedWorkItems[pid];
          if (!parent) continue;
          updatedWorkItems[pid] = {
            ...parent,
            childrenIds: parent.childrenIds.filter((cid) => cid !== id),
          };
        }
        for (const pid of newOverrideParents) {
          const parent = updatedWorkItems[pid];
          if (!parent) continue;
          if (!parent.childrenIds.includes(id)) {
            updatedWorkItems[pid] = {
              ...parent,
              childrenIds: [...parent.childrenIds, id],
            };
          }
        }

        return { workItems: updatedWorkItems };
      });
    },

    applyRealtimeWorkItemRank: (eventType, row) => {
      const workItemId = row.work_item_id as string;
      const backlogId = row.backlog_id as string;
      if (eventType !== 'DELETE' && suppressLocalRankEcho(workItemId, backlogId)) return;

      applyRemote((state) => {
        const wi = state.workItems[workItemId];
        if (!wi) return state;

        // An echo of what is held here already changes nothing; see applyRealtimeWorkItem.
        if (eventType === 'DELETE' ? !(backlogId in wi.ranks) : wi.ranks[backlogId] === ((row.rank as number) ?? 0)) return state;

        if (eventType === 'DELETE') {
          const newRanks = { ...wi.ranks };
          delete newRanks[backlogId];
          const updatedWorkItems = { ...state.workItems, [workItemId]: { ...wi, ranks: newRanks } };
          return { workItems: updatedWorkItems };
        }

        // INSERT or UPDATE
        const newRank = (row.rank as number) ?? 0;
        const newRanks = { ...wi.ranks, [backlogId]: newRank };
        const updatedWorkItems = { ...state.workItems, [workItemId]: { ...wi, ranks: newRanks } };

        // NOTE: do NOT call dedupWorkItemRanksInPlace here.  A batch reorder
        // writes N rank rows to the DB; realtime events arrive one-by-one, so
        // between the first and last event the local state has transient rank
        // collisions.  Running dedup on each event bumps sibling ranks upward;
        // those inflated values get written to the DB if the user edits any
        // item before all events have arrived, permanently corrupting the order.
        // Dedup at load time (sanitizeData) is sufficient to repair any genuine
        // duplicates that escaped to the DB.

        // Debounce the childrenIds re-sort for this parent so that a batch
        // of N realtime rank events coalesces into a single sort in a
        // microtask.  Without this, each event re-sorts immediately with
        // partial rank data, causing the visible "jump then correct" flicker.
        const treeId = state.backlogs[backlogId]?.treeId;
        if (wi.parentId && treeId) {
          const key = `${wi.parentId}::${treeId}`;
          pendingRankResorts.set(key, { parentId: wi.parentId, treeId });
          if (!rankResortScheduled) {
            rankResortScheduled = true;
            queueMicrotask(flushRankResorts);
          }
        }

        return { workItems: updatedWorkItems };
      });
    },

    applyRealtimeWorkItemBoardRank: (eventType, row) => {
      const workItemId = row.work_item_id as string;
      const backlogId = row.backlog_id as string;
      if (eventType !== 'DELETE' && suppressLocalBoardRankEcho(workItemId, backlogId)) return;

      applyRemote((state) => {
        const wi = state.workItems[workItemId];
        if (!wi) return state;
        const current = wi.boardRanks ?? {};
        // An echo of what is held here already changes nothing; see applyRealtimeWorkItem.
        if (eventType === 'DELETE' ? !(backlogId in current) : current[backlogId] === ((row.rank as number) ?? 0)) return state;
        if (eventType === 'DELETE') {
          const next = { ...current };
          delete next[backlogId];
          return { workItems: { ...state.workItems, [workItemId]: { ...wi, boardRanks: next } } };
        }
        const next = { ...current, [backlogId]: (row.rank as number) ?? 0 };
        return { workItems: { ...state.workItems, [workItemId]: { ...wi, boardRanks: next } } };
      });
    },

    applyRealtimeBacklog: (eventType, row) => {
      applyRemote((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.backlogs[id]) return state;
          const bl = state.backlogs[id];
          const updatedBacklogs = { ...state.backlogs };
          delete updatedBacklogs[id];
          const updatedTrees = { ...state.backlogTrees };
          if (bl.parentId && updatedBacklogs[bl.parentId]) {
            updatedBacklogs[bl.parentId] = {
              ...updatedBacklogs[bl.parentId],
              childrenIds: updatedBacklogs[bl.parentId].childrenIds.filter((cid) => cid !== id),
            };
          } else if (updatedTrees[bl.treeId]) {
            updatedTrees[bl.treeId] = {
              ...updatedTrees[bl.treeId],
              rootBacklogIds: updatedTrees[bl.treeId].rootBacklogIds.filter((bid) => bid !== id),
            };
          }
          return { backlogs: updatedBacklogs, backlogTrees: updatedTrees };
        }

        // INSERT or UPDATE: preserve existing childrenIds from current state
        const newBacklog: Backlog = {
          id,
          name: row.name as string,
          parentId: (row.parent_id as string | null) ?? null,
          childrenIds: state.backlogs[id]?.childrenIds ?? [],
          treeId: row.tree_id as string,
          rank: row.rank as number,
          boardHiddenStatusKeys: (row.board_hidden_status_keys as string[] | null) ?? [],
          viewMode:
            (row.view_mode as string | null) === 'board'
              ? 'board'
              : (row.view_mode as string | null) === 'timeline'
                ? 'timeline'
                : 'list',
          // Rebuilt field by field, so a field left out here is wiped by the
          // echo of every save — which is how switching stars on showed them
          // and then took them away. A row without the column says nothing
          // about it, so what is known stands rather than reading as "off".
          ratingsEnabled:
            'ratings_enabled' in row
              ? (row.ratings_enabled as boolean | null) === true
              : state.backlogs[id]?.ratingsEnabled,
          // And for its created-dates switch, for the same reason.
          createdDatesEnabled:
            'created_dates_enabled' in row
              ? (row.created_dates_enabled as boolean | null) === true
              : state.backlogs[id]?.createdDatesEnabled,
          startEndDatesEnabled:
            'start_end_dates_enabled' in row
              ? (row.start_end_dates_enabled as boolean | null) === true
              : state.backlogs[id]?.startEndDatesEnabled,
          // The same for its estimate: left out, the echo of setting one would
          // take it away again a moment later.
          points: 'points' in row ? ((row.points as number | null) ?? undefined) : state.backlogs[id]?.points,
        };

        const updatedBacklogs = { ...state.backlogs, [id]: newBacklog };
        const updatedTrees = { ...state.backlogTrees };

        const sortBacklogIds = (ids: string[]) =>
          [...ids].sort((a, b) => (updatedBacklogs[a]?.rank ?? 0) - (updatedBacklogs[b]?.rank ?? 0));

        const oldBacklog = state.backlogs[id];
        const oldParentId = oldBacklog?.parentId ?? null;
        const oldTreeId = oldBacklog?.treeId ?? null;
        const parentChanged = oldParentId !== newBacklog.parentId || oldTreeId !== newBacklog.treeId;

        if (eventType === 'INSERT' || parentChanged) {
          // Remove from old location (UPDATE reparent case)
          if (oldBacklog && parentChanged) {
            if (oldParentId && updatedBacklogs[oldParentId]) {
              updatedBacklogs[oldParentId] = {
                ...updatedBacklogs[oldParentId],
                childrenIds: updatedBacklogs[oldParentId].childrenIds.filter((cid) => cid !== id),
              };
            } else if (oldTreeId && updatedTrees[oldTreeId]) {
              updatedTrees[oldTreeId] = {
                ...updatedTrees[oldTreeId],
                rootBacklogIds: updatedTrees[oldTreeId].rootBacklogIds.filter((bid) => bid !== id),
              };
            }
          }
          // Add to new location if not already present
          if (newBacklog.parentId && updatedBacklogs[newBacklog.parentId]) {
            const parent = updatedBacklogs[newBacklog.parentId];
            if (!parent.childrenIds.includes(id)) {
              updatedBacklogs[newBacklog.parentId] = { ...parent, childrenIds: sortBacklogIds([...parent.childrenIds, id]) };
            }
          } else if (updatedTrees[newBacklog.treeId]) {
            const tree = updatedTrees[newBacklog.treeId];
            if (!tree.rootBacklogIds.includes(id)) {
              updatedTrees[newBacklog.treeId] = { ...tree, rootBacklogIds: sortBacklogIds([...tree.rootBacklogIds, id]) };
            }
          }
        } else {
          // Same parent: re-sort in case rank changed
          if (newBacklog.parentId && updatedBacklogs[newBacklog.parentId]) {
            const parent = updatedBacklogs[newBacklog.parentId];
            updatedBacklogs[newBacklog.parentId] = { ...parent, childrenIds: sortBacklogIds(parent.childrenIds) };
          } else if (updatedTrees[newBacklog.treeId]) {
            const tree = updatedTrees[newBacklog.treeId];
            updatedTrees[newBacklog.treeId] = { ...tree, rootBacklogIds: sortBacklogIds(tree.rootBacklogIds) };
          }
        }

        return { backlogs: updatedBacklogs, backlogTrees: updatedTrees };
      });
    },

    applyRealtimeBacklogTree: (eventType, row) => {
      applyRemote((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.backlogTrees[id]) return state;
          const updatedTrees = { ...state.backlogTrees };
          delete updatedTrees[id];
          return { backlogTrees: updatedTrees };
        }

        // INSERT or UPDATE: preserve existing rootBacklogIds so backlogs stay attached
        const newTree: BacklogTree = {
          id,
          name: row.name as string,
          rank: row.rank as number,
          rootBacklogIds: state.backlogTrees[id]?.rootBacklogIds ?? [],
          pointsEnabled: (row as { points_enabled?: boolean | null }).points_enabled ?? null,
        };

        return { backlogTrees: { ...state.backlogTrees, [id]: newTree } };
      });
    },

    applyRealtimeHyperlink: (eventType, row) => {
      applyRemote((state) => {
        const id = row.id as string;
        const workItemId = row.work_item_id as string;

        if (eventType === 'DELETE') {
          const existing = state.hyperlinks[workItemId] ?? [];
          const filtered = existing.filter((l) => l.id !== id);
          if (filtered.length === existing.length) return state;
          return { hyperlinks: { ...state.hyperlinks, [workItemId]: filtered } };
        }

        // INSERT or UPDATE
        const link: Hyperlink = {
          id,
          workItemId,
          url: row.url as string,
          altText: (row.alt_text as string) ?? '',
          rank: (row.rank as number) ?? 0,
        };

        const existing = state.hyperlinks[workItemId] ?? [];
        const idx = existing.findIndex((l) => l.id === id);
        let newList: Hyperlink[];
        if (idx >= 0) {
          newList = [...existing];
          newList[idx] = link;
        } else {
          newList = [...existing, link];
        }
        newList.sort((a, b) => a.rank - b.rank);

        return { hyperlinks: { ...state.hyperlinks, [workItemId]: newList } };
      });
    },
  };
}
