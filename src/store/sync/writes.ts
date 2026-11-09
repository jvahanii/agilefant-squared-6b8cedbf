/**
 * Saving to Supabase: items, lists, trees, ranks and links, deleting and
 * restoring them, and resetting an organization to the sample data. Taken out
 * of supabaseSync.ts word for word.
 */
import { supabase } from '@/integrations/supabase/client';
import { paginateSelect } from '@/integrations/supabase/pagination';
import { WorkItem, Backlog, BacklogTree, Hyperlink } from '@/types/models';
import { toast } from '@/hooks/use-toast';
import { notifyPersistDebug } from '@/lib/persistDebug';
import { markContainersDeleted, isRecentlyDeletedContainer } from '../deletedContainers';
import {
  forgetDeletedWorkItems,
  isRecentlyDeletedWorkItem,
  markWorkItemDeletesSettled,
  markWorkItemsDeleted,
} from '../deletedWorkItems';
import { safeRank, enqueueWorkItemMutation, ownerOrgOf, isStalePrefix, repairStaleOrgPrefixes, withSessionRetry, withDeadlockRetry, RANK_WRITE_CHUNK, withStallRetry, type WorkItemUpsertRow, type WorkItemBacklogRankUpsert, type WorkItemBoardRankUpsert } from "./common";

export async function upsertWorkItem(item: WorkItem, organizationId: string): Promise<boolean> {
  return enqueueWorkItemMutation(async () => upsertWorkItemImmediate(item, organizationId));
}

export async function upsertWorkItemImmediate(item: WorkItem, organizationId: string): Promise<boolean> {
  // Queued before a delete that has since been made: saving it would insert the item again.
  if (isRecentlyDeletedWorkItem(item.id)) return true;
  const effectiveOrgId = item.organizationId ?? organizationId;

  // Only run the (potentially expensive) stale-prefix repair RPC when the
  // item's ID prefix does NOT match its effective org.  Newly-created items
  // always have the correct prefix, and items that haven't been transferred
  // between orgs do too — the common case is a no-op that saves a DB RPC.
  let resolvedId = item.id;
  if (isStalePrefix(item.id, effectiveOrgId)) {
    const oldToNew = await repairStaleOrgPrefixes([item], organizationId);
    resolvedId = oldToNew[item.id] ?? item.id;
  }

  const row: WorkItemUpsertRow = {
    id: resolvedId, title: item.title, description: item.description ?? null,
    points: item.points ?? null, rating: item.rating ?? null, deadline: item.deadline ?? null, started_on: item.startedOn ?? null, ended_on: item.endedOn ?? null, status: item.status, parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments, rank: 0,
    organization_id: effectiveOrgId,
    respawn_enabled: item.respawnEnabled ?? false,
    respawn_interval_days: item.respawnIntervalDays ?? null,
    respawn_hour: item.respawnHour ?? null,
    respawn_minute: item.respawnMinute ?? null,
    respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
  };
  // Always include parent_id_overrides. Local state is the source of truth
  // (loaded from DB on fetch).  Omitting it in a batch where any other row
  // includes the column causes PostgREST to fill in NULL, which violates
  // the column's NOT NULL constraint.
  row.parent_id_overrides = item.parentIds ?? {};
  if (item.createdOn) row.created_on = item.createdOn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withStallRetry(() => withSessionRetry(() => withDeadlockRetry(() => supabase.from('work_items').upsert(row as any))));
  if (error) {
    console.error('upsertWorkItem:', error, 'row:', row);
    toast({ title: 'Failed to save', description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
    return false;
  }
  notifyPersistDebug('workitem', item.title);
  // Persist per-backlog ranks to the dedicated table
  return upsertWorkItemBacklogRanks(resolvedId, item.ranks, effectiveOrgId);
}

/** Delete stale per-backlog rank rows for a set of (workItemId, backlogId) pairs. */
export async function deleteWorkItemBacklogRanks(
  pairs: Array<{ workItemId: string; backlogId: string }>,
): Promise<void> {
  if (pairs.length === 0) return;
  // Build an OR filter: each pair is (work_item_id = X AND backlog_id = Y).
  // Supabase doesn't support tuple IN directly, so we group by work_item_id.
  const byItem = new Map<string, string[]>();
  for (const { workItemId, backlogId } of pairs) {
    if (!byItem.has(workItemId)) byItem.set(workItemId, []);
    byItem.get(workItemId)!.push(backlogId);
  }
  for (const [workItemId, backlogIds] of byItem) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('work_item_backlog_ranks' as any)
      .delete()
      .eq('work_item_id', workItemId)
      .in('backlog_id', backlogIds);
    if (error) console.error('deleteWorkItemBacklogRanks:', error);
  }
}

/**
 * Delete work items, and everything that cascades from them.
 *
 * The delete waits its turn in the work item queue. It used to run at once, so
 * saves of the same item queued a moment earlier reached the database after it
 * and inserted the item again. The ids are also marked deleted straight away, so
 * any such save still waiting is skipped.
 *
 * bulk_delete_work_items keeps a copy of each item and its child rows, which
 * restoreWorkItems puts back when the delete is undone.
 */
export async function deleteWorkItems(ids: string[]) {
  if (ids.length === 0) return;
  markWorkItemsDeleted(ids);
  return enqueueWorkItemMutation(async () => {
    try {
      // Also delete any double-prefixed variants that may exist in the DB
      const allIds = new Set(ids);
      ids.forEach(id => {
        const parts = id.split('::');
        if (parts.length === 2) {
          allIds.add(`${parts[0]}::${id}`);
        }
      });
      // Route through bulk_delete_work_items RPC which sets burnups.skip_history=on
      // to suppress per-row history snapshots for cascade deletes.
      const { error } = await supabase.rpc('bulk_delete_work_items', { _ids: [...allIds] });
      if (error) {
        console.error('deleteWorkItems (rpc):', error);
        // Fallback in case RPC is unavailable
        const { error: fallbackErr } = await supabase.from('work_items').delete().in('id', [...allIds]);
        if (fallbackErr) console.error('deleteWorkItems (fallback):', fallbackErr);
      }
      notifyPersistDebug('workitem', ids.length === 1 ? `Deleted` : `Deleted ${ids.length} items`);
    } finally {
      markWorkItemDeletesSettled(ids);
    }
  });
}

/**
 * Put back work items whose delete is being undone: the rows, their ranks and
 * board ranks, hyperlinks, team assignments, financials, snoozes and scrambles.
 *
 * restore_deleted_work_items does it from the copy the delete kept, which holds
 * rows this page cannot read (a scramble's original title, other members'
 * snoozes). For any item it did not restore — deleted before that copy existed,
 * or the function not deployed yet — what the page holds is written instead:
 * the item, its ranks, board ranks and hyperlinks.
 */
export async function restoreWorkItems(
  items: WorkItem[],
  organizationId: string,
  hyperlinks: Record<string, Hyperlink[]>,
): Promise<boolean> {
  if (items.length === 0) return true;
  const ids = items.map((item) => item.id);
  forgetDeletedWorkItems(ids);
  return enqueueWorkItemMutation(async () => {
    const restored = new Set<string>();
    const { data, error } = await supabase.rpc('restore_deleted_work_items', { _ids: ids });
    if (error) console.error('restoreWorkItems (rpc):', error);
    else for (const id of (data ?? []) as string[]) restored.add(id);

    const rest = items.filter((item) => !restored.has(item.id));
    if (rest.length === 0) {
      notifyPersistDebug('workitem', items.length === 1 ? 'Restored' : `Restored ${items.length} items`);
      return true;
    }

    if (!(await upsertWorkItemsImmediate(rest, organizationId))) return false;

    const boardRows = rest.flatMap((item) =>
      Object.entries(item.boardRanks ?? {}).map(([backlogId, rank]) => ({
        workItemId: item.id, backlogId, rank, organizationId: item.organizationId ?? organizationId,
      })),
    );
    const boardOk = (await upsertWorkItemBoardRankRowsDetailed(boardRows)).ok;

    const linkRows = rest.flatMap((item) =>
      (hyperlinks[item.id] ?? []).map((link) => ({
        id: link.id,
        work_item_id: item.id,
        url: link.url,
        alt_text: link.altText,
        rank: safeRank(link.rank),
        organization_id: item.organizationId ?? ownerOrgOf(item.id, organizationId),
      })),
    );
    let linksOk = true;
    if (linkRows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: linkError } = await withSessionRetry(() => supabase.from('work_item_hyperlinks' as any).upsert(linkRows as any));
      if (linkError) {
        console.error('restoreWorkItems (hyperlinks):', linkError);
        toast({ title: 'Failed to restore hyperlinks', description: 'Please check your connection and try again.', variant: 'destructive' });
        linksOk = false;
      }
    }
    return boardOk && linksOk;
  });
}

export async function upsertBacklog(bl: Backlog, organizationId: string) {
  if (isRecentlyDeletedContainer(bl.id) || isRecentlyDeletedContainer(bl.treeId)) return;
  const { error } = await supabase.from('backlogs').upsert({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: safeRank(bl.rank),
    organization_id: ownerOrgOf(bl.id, organizationId),
  });
  if (error) console.error('upsertBacklog:', error);
}

export async function updateBacklogHiddenStatusKeys(backlogId: string, keys: string[]) {
  const { error } = await supabase
    .from('backlogs')
    .update({ board_hidden_status_keys: keys } as any)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogHiddenStatusKeys:', error);
}

export async function updateBacklogRatingsEnabled(backlogId: string, enabled: boolean) {
  const { error } = await supabase
    .from('backlogs')
    .update({ ratings_enabled: enabled } as never)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogRatingsEnabled:', error);
}

export async function updateBacklogCreatedDatesEnabled(backlogId: string, enabled: boolean) {
  const { error } = await supabase
    .from('backlogs')
    .update({ created_dates_enabled: enabled } as never)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogCreatedDatesEnabled:', error);
}

export async function updateBacklogStartEndDatesEnabled(backlogId: string, enabled: boolean) {
  const { error } = await supabase
    .from('backlogs')
    .update({ start_end_dates_enabled: enabled } as never)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogStartEndDatesEnabled:', error);
}

/**
 * A backlog's own points, or null to take them away. Its own call rather than a
 * field of upsertBacklog(s): those write on every rename and move, and would put
 * back whatever the page happened to hold at the time.
 */
export async function updateBacklogPoints(backlogId: string, points: number | null) {
  const { error } = await supabase
    .from('backlogs')
    .update({ points } as never)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogPoints:', error);
}

export async function updateBacklogViewMode(backlogId: string, mode: 'list' | 'board' | 'timeline') {
  const { error } = await supabase
    .from('backlogs')
    .update({ view_mode: mode } as any)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogViewMode:', error);
}

export async function deleteBacklogs(ids: string[]) {
  if (ids.length === 0) return;
  markContainersDeleted(ids);
  // Also delete any double-prefixed variants that may exist in the DB
  const allIds = new Set(ids);
  ids.forEach(id => {
    const parts = id.split('::');
    if (parts.length === 2) {
      allIds.add(`${parts[0]}::${id}`);
    }
  });
  const { error } = await supabase.from('backlogs').delete().in('id', [...allIds]);
  if (error) console.error('deleteBacklogs:', error);
}

export async function upsertBacklogTree(tree: BacklogTree, organizationId: string) {
  const { error } = await supabase.from('backlog_trees').upsert({
    id: tree.id, name: tree.name, rank: safeRank(tree.rank),
    organization_id: ownerOrgOf(tree.id, organizationId),
    points_enabled: tree.pointsEnabled ?? null,
  } as never);
  if (error) console.error('upsertBacklogTree:', error);
}

export async function deleteBacklogTree(id: string) {
  markContainersDeleted([id]);
  // Also delete any double-prefixed variants that may exist in the DB
  const parts = id.split('::');
  const allIds = [id];
  if (parts.length === 2) {
    allIds.push(`${parts[0]}::${id}`);
  }
  const { error } = await supabase.from('backlog_trees').delete().in('id', allIds);
  if (error) console.error('deleteBacklogTree:', error);
}

export async function upsertWorkItems(items: WorkItem[], organizationId: string): Promise<boolean> {
  return enqueueWorkItemMutation(async () => upsertWorkItemsImmediate(items, organizationId));
}

export async function upsertWorkItemsImmediate(allItems: WorkItem[], organizationId: string): Promise<boolean> {
  // Queued before a delete that has since been made: saving them would insert them again.
  const items = allItems.filter((item) => !isRecentlyDeletedWorkItem(item.id));
  if (items.length === 0) return true;

  // Only call the (potentially expensive) stale-prefix repair RPC when at
  // least one item actually has a mismatched org prefix.  Newly-created
  // items always have the correct prefix, making this a no-op in the
  // common case and saving a DB RPC on every mutation.
  const anyStale = items.some(item => {
    const effectiveOrgId = item.organizationId ?? organizationId;
    return isStalePrefix(item.id, effectiveOrgId);
  });
  const oldToNew = anyStale
    ? await repairStaleOrgPrefixes(items, organizationId)
    : ({} as Record<string, string>);

  const rows: WorkItemUpsertRow[] = items.map(item => {
    const resolvedId = oldToNew[item.id] ?? item.id;
    const effectiveOrgId = item.organizationId ?? organizationId;
    const row: WorkItemUpsertRow = {
      id: resolvedId, title: item.title, description: item.description ?? null,
      points: item.points ?? null, rating: item.rating ?? null, deadline: item.deadline ?? null, started_on: item.startedOn ?? null, ended_on: item.endedOn ?? null, status: item.status, parent_id: item.parentId,
      backlog_assignments: item.backlogAssignments, rank: 0,
      organization_id: effectiveOrgId,
      respawn_enabled: item.respawnEnabled ?? false,
      respawn_interval_days: item.respawnIntervalDays ?? null,
      respawn_hour: item.respawnHour ?? null,
      respawn_minute: item.respawnMinute ?? null,
      respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
    };
    // Always include parent_id_overrides — see note in upsertWorkItem.
    row.parent_id_overrides = item.parentIds ?? {};
    if (item.createdOn) row.created_on = item.createdOn;
    return row;
  });
  // Dedupe by id (last write wins) so a single upsert payload never contains
  // two rows that conflict on the same primary key — Postgres rejects those
  // with "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const dedupedById = new Map<string, WorkItemUpsertRow>();
  for (const row of rows) dedupedById.set(row.id, row);
  // In id order, which is the order the rank rows for the same items are
  // written in (upsertRankRowsSkippingMissing): two writes that take the same
  // items in the same order cannot each end up waiting for the other.
  const dedupedRows = Array.from(dedupedById.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Rows that name created_on and rows that leave it out go in separate
  // requests. In one request PostgREST fills a column some rows omit with
  // NULL for those rows, which is exactly the wipe leaving it out is for.
  let error: { message?: string } | null = null;
  for (const group of [
    dedupedRows.filter((row) => row.created_on !== undefined),
    dedupedRows.filter((row) => row.created_on === undefined),
  ]) {
    if (group.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ error } = await withStallRetry(() => withSessionRetry(() => withDeadlockRetry(() => supabase.from('work_items').upsert(group as any)))));
    if (error) break;
  }
  if (error) {
    console.error('upsertWorkItems:', error, 'rows:', dedupedRows);
    toast({ title: 'Failed to save', description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
    return false;
  }
  notifyPersistDebug('workitem', items.length === 1 ? items[0].title : `${items.length} items`);
  // Persist per-backlog ranks to the dedicated table
  return upsertWorkItemBacklogRanksBatch(items, oldToNew, organizationId);
}

export async function upsertBacklogs(bls: Backlog[], organizationId: string) {
  bls = bls.filter((bl) => !isRecentlyDeletedContainer(bl.id) && !isRecentlyDeletedContainer(bl.treeId));
  if (bls.length === 0) return;
  const rows = bls.map(bl => ({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: safeRank(bl.rank),
    organization_id: ownerOrgOf(bl.id, organizationId),
  }));
  const { error } = await supabase.from('backlogs').upsert(rows);
  if (error) console.error('upsertBacklogs:', error);
}

export async function upsertBacklogTrees(trees: BacklogTree[], organizationId: string) {
  trees = trees.filter((t) => !isRecentlyDeletedContainer(t.id));
  if (trees.length === 0) return;
  const rows = trees.map(t => ({
    id: t.id, name: t.name, rank: safeRank(t.rank),
    organization_id: ownerOrgOf(t.id, organizationId),
    points_enabled: t.pointsEnabled ?? null,
  }));
  const { error } = await supabase.from('backlog_trees').upsert(rows as never);
  if (error) console.error('upsertBacklogTrees:', error);
}

export type MockDataSnapshot = {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
};

export function scopeMockDataToOrganization(organizationId: string, mockData: MockDataSnapshot): MockDataSnapshot {
  const prefix = `${organizationId}::`;

  const treeIdMap = Object.fromEntries(
    Object.keys(mockData.backlogTrees).map((id) => [id, `${prefix}${id}`])
  ) as Record<string, string>;

  const backlogIdMap = Object.fromEntries(
    Object.keys(mockData.backlogs).map((id) => [id, `${prefix}${id}`])
  ) as Record<string, string>;

  const workItemIdMap = Object.fromEntries(
    Object.keys(mockData.workItems).map((id) => [id, `${prefix}${id}`])
  ) as Record<string, string>;

  const backlogTrees = Object.fromEntries(
    Object.values(mockData.backlogTrees).map((tree) => {
      const nextId = treeIdMap[tree.id];
      return [
        nextId,
        {
          ...tree,
          id: nextId,
          rootBacklogIds: tree.rootBacklogIds.map((id) => backlogIdMap[id]),
        },
      ];
    })
  );

  const backlogs = Object.fromEntries(
    Object.values(mockData.backlogs).map((backlog) => {
      const nextId = backlogIdMap[backlog.id];
      return [
        nextId,
        {
          ...backlog,
          id: nextId,
          parentId: backlog.parentId ? backlogIdMap[backlog.parentId] : null,
          childrenIds: backlog.childrenIds.map((id) => backlogIdMap[id]),
          treeId: treeIdMap[backlog.treeId],
        },
      ];
    })
  );

  const workItems = Object.fromEntries(
    Object.values(mockData.workItems).map((item) => {
      const nextId = workItemIdMap[item.id];
      return [
        nextId,
        {
          ...item,
          id: nextId,
          parentId: item.parentId ? workItemIdMap[item.parentId] : null,
          childrenIds: item.childrenIds.map((id) => workItemIdMap[id]),
          backlogAssignments: Object.fromEntries(
            Object.entries(item.backlogAssignments).map(([treeId, backlogId]) => [
              treeIdMap[treeId],
              backlogIdMap[backlogId],
            ])
          ),
          ranks: Object.fromEntries(
            Object.entries(item.ranks).map(([backlogId, rank]) => [
              backlogIdMap[backlogId] ?? backlogId,
              rank,
            ])
          ),
        },
      ];
    })
  );

  return { workItems, backlogs, backlogTrees };
}

export async function resetOrgData(organizationId: string, mockData: MockDataSnapshot) {
  const scopedMockData = scopeMockDataToOrganization(organizationId, mockData);

  // Delete ranks first (FK to work_items)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('work_item_backlog_ranks' as any).delete().eq('organization_id', organizationId);

  const { error: deleteItemsError } = await supabase
    .from('work_items')
    .delete()
    .eq('organization_id', organizationId);
  if (deleteItemsError) throw deleteItemsError;

  const { error: deleteBacklogsError } = await supabase
    .from('backlogs')
    .delete()
    .eq('organization_id', organizationId);
  if (deleteBacklogsError) throw deleteBacklogsError;

  const { error: deleteTreesError } = await supabase
    .from('backlog_trees')
    .delete()
    .eq('organization_id', organizationId);
  if (deleteTreesError) throw deleteTreesError;

  const treeRows = Object.values(scopedMockData.backlogTrees).map((tree) => ({
    id: tree.id,
    name: tree.name,
    rank: safeRank(tree.rank),
    organization_id: organizationId,
  }));
  if (treeRows.length > 0) {
    const { error } = await supabase.from('backlog_trees').insert(treeRows);
    if (error) throw error;
  }

  const backlogRows = Object.values(scopedMockData.backlogs).map((backlog) => ({
    id: backlog.id,
    name: backlog.name,
    parent_id: backlog.parentId,
    tree_id: backlog.treeId,
    rank: safeRank(backlog.rank),
    organization_id: organizationId,
  }));
  if (backlogRows.length > 0) {
    const { error } = await supabase.from('backlogs').insert(backlogRows);
    if (error) throw error;
  }

  const itemRows = Object.values(scopedMockData.workItems).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description ?? null,
    points: item.points ?? null, rating: item.rating ?? null, deadline: item.deadline ?? null,
    status: item.status,
    parent_id: item.parentId,
    parent_id_overrides: item.parentIds ?? {},
    backlog_assignments: item.backlogAssignments,
    rank: 0,
    organization_id: organizationId,
  }));
  if (itemRows.length > 0) {
    const { error } = await supabase.from('work_items').insert(itemRows);
    if (error) throw error;
  }

  // Insert per-backlog ranks
  const rankRows: Array<{ work_item_id: string; backlog_id: string; rank: number; organization_id: string }> = [];
  for (const item of Object.values(scopedMockData.workItems)) {
    for (const [backlogId, rank] of Object.entries(item.ranks)) {
      rankRows.push({
        work_item_id: item.id,
        backlog_id: backlogId,
        rank: safeRank(rank),
        organization_id: organizationId,
      });
    }
  }
  if (rankRows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('work_item_backlog_ranks' as any).insert(rankRows);
    if (error) throw error;
  }
}

/** Upsert per-backlog ranks for a single work item. */
export async function upsertWorkItemBacklogRanks(
  workItemId: string,
  ranks: Record<string, number>,
  organizationId: string,
): Promise<boolean> {
  const rows = Object.entries(ranks).map(([backlogId, rank]) => ({ workItemId, backlogId, rank, organizationId }));
  return upsertWorkItemBacklogRankRowsImmediate(rows);
}

export async function upsertWorkItemBacklogRankRows(
  rowsToUpsert: WorkItemBacklogRankUpsert[],
): Promise<boolean> {
  return (await upsertWorkItemBacklogRankRowsDetailed(rowsToUpsert)).ok;
}

/** What a rank write achieved, for callers that keep a retry queue. */
export interface RankUpsertResult {
  /** Every row was written, or skipped because its work item does not exist. */
  ok: boolean;
  /**
   * Work items the rows named that are not in the database, so their rows were
   * not written. Either deleted — the rank is moot — or not inserted yet; only
   * the caller can tell which, from what it still holds locally.
   */
  missingWorkItemIds: string[];
}

export type RankRow = { work_item_id: string; backlog_id: string; rank: number; organization_id: string };

/** Of these work item ids, the ones the database has. Null if it cannot say. */
export async function existingWorkItemIds(ids: string[]): Promise<Set<string> | null> {
  const found = new Set<string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    // Never more than 200 rows, by primary key, but paginated all the same:
    // reads from work_items go through the shared helper, which is what the
    // pagination guard checks for.
    const { data, error } = await paginateSelect<{ id: string }>((from, to) =>
      supabase.from('work_items').select('id').in('id', chunk).order('id', { ascending: true }).range(from, to),
    );
    if (error) return null;
    for (const row of data ?? []) found.add(row.id);
  }
  return found;
}

/**
 * Upsert rank rows, surviving rows whose work item no longer exists.
 *
 * Both rank tables reference work_items, so a single row for a deleted item
 * made the whole payload fail — and because failed writes stay in the retry
 * queue and are re-sent on every load, that one row failed every write after
 * it too, showing "Failed to save ranking" again and again. A rank for an item
 * that is gone has nothing left to order, so on that one error the rows are
 * checked, the rest are written, and the missing items are reported rather
 * than treated as a failure.
 *
 * The check costs nothing on the normal path: it runs only after the database
 * has already refused the write for exactly this reason.
 */
export async function upsertRankRowsSkippingMissing(
  table: 'work_item_backlog_ranks' | 'work_item_board_ranks',
  rows: RankRow[],
  failureTitle: string,
): Promise<RankUpsertResult> {
  // A rank for an item just deleted here is reported missing without asking the
  // database, which may not have processed the delete yet and would take it.
  const recentlyDeleted = [...new Set(rows.filter((r) => isRecentlyDeletedWorkItem(r.work_item_id)).map((r) => r.work_item_id))];
  if (recentlyDeleted.length > 0) rows = rows.filter((r) => !isRecentlyDeletedWorkItem(r.work_item_id));
  if (rows.length === 0) return { ok: true, missingWorkItemIds: recentlyDeleted };
  // Sort by (work_item_id, backlog_id) so concurrent upserts always acquire
  // row locks in the same order, preventing PostgreSQL deadlocks.
  rows.sort((a, b) => a.work_item_id < b.work_item_id ? -1 : a.work_item_id > b.work_item_id ? 1 : a.backlog_id < b.backlog_id ? -1 : a.backlog_id > b.backlog_id ? 1 : 0);

  // Tried again when it loses a deadlock to the write of the items it ranks,
  // and after a pause when a busy database stopped it for taking too long.
  const writeBatch = async (payload: RankRow[]) => {
    const result = await withStallRetry(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withDeadlockRetry(() => supabase.from(table as any).upsert(payload, { onConflict: 'work_item_id,backlog_id' })),
    );
    return result.error;
  };
  // A batch at a time, so no one statement carries a whole long list.
  const write = async (payload: RankRow[]) => {
    for (let at = 0; at < payload.length; at += RANK_WRITE_CHUNK) {
      const error = await writeBatch(payload.slice(at, at + RANK_WRITE_CHUNK));
      if (error) return error;
    }
    return null;
  };

  let error = await write(rows);
  let missing: string[] = recentlyDeleted;
  // 23503 is foreign_key_violation. The constraint name is checked too, so a
  // foreign key added to these tables later is not mistaken for this one.
  if (error?.code === '23503' && /work_item_id_fkey/.test(error.message ?? '')) {
    const existing = await existingWorkItemIds(rows.map((r) => r.work_item_id));
    if (existing) {
      missing = [...new Set([...recentlyDeleted, ...rows.filter((r) => !existing.has(r.work_item_id)).map((r) => r.work_item_id)])];
      const writable = rows.filter((r) => existing.has(r.work_item_id));
      error = writable.length > 0 ? await write(writable) : null;
    }
  }

  if (error) {
    console.error(`upsert ${table}:`, error);
    toast({ title: failureTitle, description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
    return { ok: false, missingWorkItemIds: missing };
  }
  if (missing.length > recentlyDeleted.length) {
    console.warn(`upsert ${table}: skipped ranks for ${missing.length} work item(s) not in the database`, missing);
  }
  return { ok: true, missingWorkItemIds: missing };
}

export async function upsertWorkItemBacklogRankRowsDetailed(
  rowsToUpsert: WorkItemBacklogRankUpsert[],
): Promise<RankUpsertResult> {
  return upsertRankRowsSkippingMissing(
    'work_item_backlog_ranks',
    rowsToUpsert.map((row) => ({
      work_item_id: row.workItemId,
      backlog_id: row.backlogId,
      rank: safeRank(row.rank),
      organization_id: row.organizationId,
    })),
    'Failed to save ranking',
  );
}

export async function upsertWorkItemBacklogRankRowsImmediate(
  rowsToUpsert: WorkItemBacklogRankUpsert[],
): Promise<boolean> {
  return (await upsertWorkItemBacklogRankRowsDetailed(rowsToUpsert)).ok;
}

/** Upsert per-backlog ranks for a batch of work items. */
export async function upsertWorkItemBacklogRanksBatch(
  items: WorkItem[],
  oldToNew: Record<string, string>,
  organizationId: string,
): Promise<boolean> {
  const rows: Array<{ work_item_id: string; backlog_id: string; rank: number; organization_id: string }> = [];
  for (const item of items) {
    const resolvedId = oldToNew[item.id] ?? item.id;
    const effectiveOrgId = item.organizationId ?? organizationId;
    for (const [backlogId, rank] of Object.entries(item.ranks)) {
      rows.push({
        work_item_id: resolvedId,
        backlog_id: backlogId,
        rank: safeRank(rank),
        organization_id: effectiveOrgId,
      });
    }
  }
  if (rows.length === 0) return true;
  // Dedupe by (work_item_id, backlog_id) so a single payload never has two
  // rows targeting the same conflict key (would raise "cannot affect row a
  // second time"). Last write wins.
  const dedup = new Map<string, typeof rows[number]>();
  for (const r of rows) dedup.set(`${r.work_item_id}::${r.backlog_id}`, r);
  // Written the way every other rank write is: sorted, in batches, and once
  // more after a deadlock or a statement timeout.
  return (await upsertRankRowsSkippingMissing('work_item_backlog_ranks', Array.from(dedup.values()), 'Failed to save ranking')).ok;
}

export async function upsertWorkItemBoardRankRows(
  rowsToUpsert: WorkItemBoardRankUpsert[],
): Promise<boolean> {
  return (await upsertWorkItemBoardRankRowsDetailed(rowsToUpsert)).ok;
}

/** Board ranks reference work_items the same way, and queue the same way. */
export async function upsertWorkItemBoardRankRowsDetailed(
  rowsToUpsert: WorkItemBoardRankUpsert[],
): Promise<RankUpsertResult> {
  return upsertRankRowsSkippingMissing(
    'work_item_board_ranks',
    rowsToUpsert.map((row) => ({
      work_item_id: row.workItemId,
      backlog_id: row.backlogId,
      rank: safeRank(row.rank),
      organization_id: row.organizationId,
    })),
    'Failed to save board ranking',
  );
}

export async function deleteWorkItemBoardRanks(
  pairs: Array<{ workItemId: string; backlogId: string }>,
): Promise<void> {
  if (pairs.length === 0) return;
  const byItem = new Map<string, string[]>();
  for (const { workItemId, backlogId } of pairs) {
    if (!byItem.has(workItemId)) byItem.set(workItemId, []);
    byItem.get(workItemId)!.push(backlogId);
  }
  for (const [workItemId, backlogIds] of byItem) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('work_item_board_ranks' as any)
      .delete()
      .eq('work_item_id', workItemId)
      .in('backlog_id', backlogIds);
    if (error) console.error('deleteWorkItemBoardRanks:', error);
  }
}

export async function upsertHyperlink(link: Hyperlink, organizationId: string, itemOrgId?: string) {
  // Prefer the item's stored organization_id (passed by the caller) so we never
  // try to assign a hyperlink to a deleted org derived from a stale ID prefix.
  const effectiveOrgId = itemOrgId ?? ownerOrgOf(link.workItemId, organizationId);

  // If the work item has a stale prefix, rename it first so the FK for
  // work_item_id stays valid after the repair.
  const oldToNew = await repairStaleOrgPrefixes(
    [{ id: link.workItemId, organizationId: itemOrgId }],
    organizationId,
  );
  const resolvedWorkItemId = oldToNew[link.workItemId] ?? link.workItemId;

  const row = {
    id: link.id,
    work_item_id: resolvedWorkItemId,
    url: link.url,
    alt_text: link.altText,
    rank: safeRank(link.rank),
    organization_id: effectiveOrgId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_item_hyperlinks' as any).upsert(row as any).select().then(r => r));
  if (error) {
    console.error('upsertHyperlink:', error);
    toast({ title: 'Failed to save hyperlink', description: 'Please check your connection and try again.', variant: 'destructive' });
  }
}

export async function deleteHyperlink(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from('work_item_hyperlinks' as any).delete().eq('id', id);
  if (error) console.error('deleteHyperlink:', error);
}
