import { supabase } from '@/integrations/supabase/client';
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink } from '@/types/models';
import { toast } from '@/hooks/use-toast';

/** Ensure rank is a finite integer – guards against NaN / undefined / null leaking to the DB. */
const safeRank = (r: unknown): number => (typeof r === 'number' && Number.isFinite(r) ? r : 0);

type WorkItemUpsertRow = {
  id: string;
  title: string;
  description: string | null;
  points: number | null;
  status: string;
  parent_id: string | null;
  backlog_assignments: Record<string, string>;
  rank: number;
  organization_id: string;
  respawn_enabled: boolean;
  respawn_interval_days: number | null;
  respawn_hour: number | null;
  respawn_minute: number | null;
  respawn_last_triggered_at: string | null;
};

// ─── Pure helpers (used by both load and sync) ────────────────────────────

/**
 * Return the organization that owns an entity, derived from its ID prefix
 * (format: "<orgId>::<rawId>").  Falls back to `defaultOrgId` for unprefixed
 * legacy/mock IDs so that newly-created entities are always attributed to the
 * active org.
 *
 * `sep > 0` (not `>= 0`) is intentional: an ID starting with '::' has an
 * empty org prefix and is treated as unprefixed, falling back to defaultOrgId.
 */
function ownerOrgOf(entityId: string, defaultOrgId: string): string {
  const sep = entityId.indexOf('::');
  return sep > 0 ? entityId.slice(0, sep) : defaultOrgId;
}

/**
 * Returns true when an item's ID prefix embeds a different org than the item's
 * actual `organization_id`.  This happens when items were transferred to a new
 * org but their ID string was not yet renamed.
 */
function isStalePrefix(id: string, effectiveOrgId: string): boolean {
  const sep = id.indexOf('::');
  return sep > 0 && id.slice(0, sep) !== effectiveOrgId;
}

// ─── Load all data from Supabase (filtered by org) ────────────────────────

export async function loadFromSupabase(organizationId: string): Promise<{
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
}> {
  // Ensure the Supabase auth client has finished initialising (including any
  // pending token refresh) before issuing PostgREST queries.  Without this,
  // onAuthStateChange can fire INITIAL_SESSION while initialize() is still
  // running; the access token in currentSession may be stale, causing RLS to
  // evaluate auth.uid() as null and return empty rows for every table.
  await supabase.auth.getSession();

  // Load shared tree IDs for this org
  const { data: shares } = await supabase
    .from('backlog_tree_shares' as any)
    .select('tree_id')
    .eq('organization_id', organizationId);
  const sharedTreeIds = (shares ?? []).map((s: any) => s.tree_id as string);

  // Load own trees + shared trees
  const ownTreesPromise = supabase.from('backlog_trees').select('*').eq('organization_id', organizationId);
  const sharedTreesPromise = sharedTreeIds.length > 0
    ? supabase.from('backlog_trees').select('*').in('id', sharedTreeIds)
    : Promise.resolve({ data: [], error: null });

  const [ownTreesRes, sharedTreesRes] = await Promise.all([ownTreesPromise, sharedTreesPromise]);
  if (ownTreesRes.error) throw ownTreesRes.error;
  if (sharedTreesRes.error) throw sharedTreesRes.error;

  const allTreeRows = [...(ownTreesRes.data ?? []), ...(sharedTreesRes.data ?? [])];
  const allTreeIds = allTreeRows.map(t => t.id);

  // Load backlogs for all accessible trees
  const backlogsPromise = allTreeIds.length > 0
    ? supabase.from('backlogs').select('*').in('tree_id', allTreeIds)
    : Promise.resolve({ data: [], error: null });

  // Load own work items + work items from shared trees
  const ownItemsPromise = supabase.from('work_items').select('*').eq('organization_id', organizationId);

  const [backlogsRes, itemsRes] = await Promise.all([backlogsPromise, ownItemsPromise]);

  if (backlogsRes.error) throw backlogsRes.error;
  if (itemsRes.error) throw itemsRes.error;

  // Also load work items from partner orgs that participate in tree sharing.
  // This covers two directions:
  //   (A) Incoming shares: other orgs own trees shared TO this org – their items
  //       live under their own organization_id but are assigned to those trees.
  //   (B) Outgoing shares: this org owns trees shared WITH other orgs – items
  //       those orgs created in our trees live under their organization_id.
  let sharedWorkItems: any[] = [];

  // (A) Incoming: orgs that own the trees shared to us.
  if (sharedTreeIds.length > 0) {
    const sharedTreeIdSet = new Set(sharedTreeIds);
    const incomingPartnerOrgIds = [
      ...new Set(
        (sharedTreesRes.data ?? [])
          .map((t: any) => t.organization_id as string)
          .filter((id: string) => id !== organizationId)
      ),
    ];
    if (incomingPartnerOrgIds.length > 0) {
      const { data: incomingItems } = await supabase
        .from('work_items')
        .select('*')
        .in('organization_id', incomingPartnerOrgIds);
      // Keep only items that are actually assigned to one of the shared trees.
      const filtered = (incomingItems ?? []).filter((item: any) => {
        const assignments = item.backlog_assignments as Record<string, string>;
        return Object.keys(assignments).some(treeId => sharedTreeIdSet.has(treeId));
      });
      sharedWorkItems = [...sharedWorkItems, ...filtered];
    }
  }

  // (B) Outgoing: orgs that have been granted access to our own trees.
  const ownTreeIds = (ownTreesRes.data ?? []).map((t: any) => t.id as string);
  if (ownTreeIds.length > 0) {
    const { data: outgoingShares } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('backlog_tree_shares' as any)
      .select('organization_id')
      .in('tree_id', ownTreeIds);
    const outgoingPartnerOrgIds = [
      ...new Set(
        (outgoingShares ?? [])
          .map((s: any) => s.organization_id as string)
          .filter((id: string) => id !== organizationId)
      ),
    ];
    if (outgoingPartnerOrgIds.length > 0) {
      const ownTreeIdSet = new Set(ownTreeIds);
      const { data: outgoingItems } = await supabase
        .from('work_items')
        .select('*')
        .in('organization_id', outgoingPartnerOrgIds);
      // Keep only items assigned to one of our own trees.
      const filtered = (outgoingItems ?? []).filter((item: any) => {
        const assignments = item.backlog_assignments as Record<string, string>;
        return Object.keys(assignments).some(treeId => ownTreeIdSet.has(treeId));
      });
      sharedWorkItems = [...sharedWorkItems, ...filtered];
    }
  }

  // Auto-cleanup malformed (double-prefixed) tree IDs
  const malformedTreeIds = allTreeRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
  if (malformedTreeIds.length > 0) {
    supabase.from('backlog_trees').delete().in('id', malformedTreeIds).then(({ error }) => {
      if (error) console.error('cleanup malformed trees:', error);
    });
  }
  const cleanTreeRows = allTreeRows.filter(r => r.id.split('::').length <= 2);

  const backlogTrees: Record<string, BacklogTree> = {};
  for (const row of cleanTreeRows) {
    backlogTrees[row.id] = { id: row.id, name: row.name, rootBacklogIds: [], rank: row.rank };
  }

  // Auto-cleanup malformed (double-prefixed) backlog IDs
  const backlogRows = backlogsRes.data ?? [];
  const malformedBacklogIds = backlogRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
  if (malformedBacklogIds.length > 0) {
    supabase.from('backlogs').delete().in('id', malformedBacklogIds).then(({ error }) => {
      if (error) console.error('cleanup malformed backlogs:', error);
    });
  }
  const cleanBacklogRows = backlogRows.filter(r => r.id.split('::').length <= 2);

  const backlogs: Record<string, Backlog> = {};
  for (const row of cleanBacklogRows) {
    backlogs[row.id] = { id: row.id, name: row.name, parentId: row.parent_id, childrenIds: [], treeId: row.tree_id, rank: row.rank };
  }
  for (const bl of Object.values(backlogs)) {
    if (bl.parentId && backlogs[bl.parentId]) {
      backlogs[bl.parentId].childrenIds.push(bl.id);
    } else if (!bl.parentId && backlogTrees[bl.treeId]) {
      backlogTrees[bl.treeId].rootBacklogIds.push(bl.id);
    }
  }
  for (const bl of Object.values(backlogs)) {
    bl.childrenIds.sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0));
  }
  for (const tree of Object.values(backlogTrees)) {
    tree.rootBacklogIds.sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0));
  }

  const allItemRows = [...(itemsRes.data ?? []), ...sharedWorkItems];

  // Auto-cleanup malformed (double-prefixed) work item IDs
  const malformedItemIds = allItemRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
  if (malformedItemIds.length > 0) {
    supabase.from('work_items').delete().in('id', malformedItemIds).then(({ error }) => {
      if (error) console.error('cleanup malformed work items:', error);
    });
  }
  const cleanItemRows = allItemRows.filter(r => r.id.split('::').length <= 2);

  // Load per-backlog ranks from the work_item_backlog_ranks table.
  const workItemIds = cleanItemRows.map(r => r.id);
  const ranksMap = await loadWorkItemBacklogRanks(workItemIds);

  const workItems: Record<string, WorkItem> = {};
  for (const row of cleanItemRows) {
    const r = row as any;
    const rawAssignments = (row.backlog_assignments ?? {}) as Record<string, unknown>;
    const backlogAssignments: Record<string, string> = {};
    for (const [treeId, value] of Object.entries(rawAssignments)) {
      if (typeof value === 'string') {
        backlogAssignments[treeId] = value;
      } else if (value && typeof value === 'object' && 'backlogId' in value) {
        // Legacy enriched format – extract plain backlogId
        backlogAssignments[treeId] = (value as { backlogId: string }).backlogId;
      }
    }
    const ranks = ranksMap[row.id] ?? {};
    // Fallback: if no ranks from the table, use the deprecated global rank column
    if (Object.keys(ranks).length === 0 && typeof row.rank === 'number') {
      for (const backlogId of Object.values(backlogAssignments)) {
        ranks[backlogId] = row.rank;
      }
    }
    workItems[row.id] = {
      id: row.id, title: row.title, description: row.description ?? undefined,
      points: row.points ?? undefined, status: (row.status as WorkItemStatus) ?? 'not_started',
      parentId: row.parent_id, childrenIds: [],
      backlogAssignments,
      ranks,
      organizationId: r.organization_id ?? undefined,
      respawnEnabled: r.respawn_enabled ?? false,
      respawnIntervalDays: r.respawn_interval_days ?? undefined,
      respawnHour: r.respawn_hour ?? undefined,
      respawnMinute: r.respawn_minute ?? undefined,
      respawnLastTriggeredAt: r.respawn_last_triggered_at ?? undefined,
    };
  }
  for (const wi of Object.values(workItems)) {
    if (wi.parentId && workItems[wi.parentId]) {
      workItems[wi.parentId].childrenIds.push(wi.id);
    }
  }
  for (const wi of Object.values(workItems)) {
    wi.childrenIds.sort((a, b) => {
      const wiA = workItems[a];
      const wiB = workItems[b];
      const rankA = wiA ? Math.min(...Object.values(wiA.ranks), 0) : 0;
      const rankB = wiB ? Math.min(...Object.values(wiB.ranks), 0) : 0;
      return rankA - rankB;
    });
  }

  // ── Repair stale org prefixes at load time ────────────────────────────────
  // Items whose ID prefix embeds a deleted/old org UUID (but whose
  // organization_id column is already correct) are renamed in the DB now so
  // the local state is clean from the start.  We do this directly instead of
  // going through repairStaleOrgPrefixes() so we can patch the in-memory map
  // without triggering the store callback (the store hasn't consumed this data
  // yet).
  const staleAtLoad = Object.values(workItems).filter(
    wi => wi.organizationId && isStalePrefix(wi.id, wi.organizationId),
  );
  if (staleAtLoad.length > 0) {
    const byOrg = new Map<string, string[]>();
    for (const wi of staleAtLoad) {
      const orgId = wi.organizationId!;
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      byOrg.get(orgId)!.push(wi.id);
    }

    const loadOldToNew: Record<string, string> = {};
    for (const [orgId, ids] of byOrg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('rename_work_items_org_prefix', {
        _item_ids: ids,
        _new_org_id: orgId,
      });
      if (error) {
        console.error('loadFromSupabase: repair stale prefix failed:', error);
        continue;
      }
      Object.assign(loadOldToNew, data as Record<string, string>);
    }

    if (Object.keys(loadOldToNew).length > 0) {
      // Re-key items in the in-memory map using the new IDs.
      for (const [oldId, newId] of Object.entries(loadOldToNew)) {
        const item = workItems[oldId];
        if (!item) continue;
        workItems[newId] = {
          ...item,
          id: newId,
          parentId: item.parentId ? (loadOldToNew[item.parentId] ?? item.parentId) : null,
          childrenIds: item.childrenIds.map(cid => loadOldToNew[cid] ?? cid),
        };
        delete workItems[oldId];
      }
      // Update parentId references in items that were not themselves renamed.
      for (const item of Object.values(workItems)) {
        if (item.parentId && loadOldToNew[item.parentId]) {
          item.parentId = loadOldToNew[item.parentId];
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  return { workItems, backlogs, backlogTrees };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Callback invoked after a batch of work-item IDs has been renamed in the DB
 * so that callers (e.g. the Zustand store) can update their local state.
 * Maps old ID → new ID.
 */
export type WorkItemRenameCallback = (oldToNew: Record<string, string>) => void;
let renameCallback: WorkItemRenameCallback | null = null;

/** Register a store-level callback to be notified when work-item IDs are renamed. */
export function registerWorkItemRenameCallback(cb: WorkItemRenameCallback): void {
  renameCallback = cb;
}

/**
 * Calls the `rename_work_items_org_prefix` RPC for items whose ID prefix does
 * not match their effective `organization_id`, then notifies the registered
 * callback so the local store can update its references.
 *
 * Returns a map of old ID → new ID for all items that were renamed.
 */
async function repairStaleOrgPrefixes(
  items: Array<{ id: string; organizationId?: string }>,
  activeOrgId: string,
): Promise<Record<string, string>> {
  // Filter items whose ID prefix doesn't match their actual org.
  const stale = items.filter(item => {
    const effectiveOrg = item.organizationId ?? activeOrgId;
    return isStalePrefix(item.id, effectiveOrg);
  });
  if (stale.length === 0) return {};

  // Group by effective org (should normally all be the same org after transfer).
  const byOrg = new Map<string, string[]>();
  for (const item of stale) {
    const orgId = item.organizationId ?? activeOrgId;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(item.id);
  }

  const oldToNew: Record<string, string> = {};
  for (const [orgId, ids] of byOrg) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('rename_work_items_org_prefix', {
      _item_ids: ids,
      _new_org_id: orgId,
    });
    if (error) {
      console.error('repairStaleOrgPrefixes RPC failed:', error);
      continue;
    }
    Object.assign(oldToNew, data as Record<string, string>);
  }

  if (Object.keys(oldToNew).length > 0) {
    renameCallback?.(oldToNew);
  }
  return oldToNew;
}

// ─── Sync helpers ──────────────────────────────────────────────────────────

/** Refresh the Supabase auth session and retry a DB operation once on auth errors. */
async function withSessionRetry(
  operation: () => PromiseLike<{ error: { message?: string; code?: string } | null }>
): Promise<{ error: { message?: string; code?: string } | null }> {
  const result = await operation();
  if (!result.error) return result;

  // Only attempt a refresh + retry for auth-related errors (expired/invalid JWT, RLS violation).
  const { code, message } = result.error;
  const isAuthError =
    (code && (code.startsWith('PGRST') || code === '42501')) ||
    (message && (message.includes('JWT') || message.includes('not authenticated')));
  if (!isAuthError) return result;

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) return result; // Refresh itself failed – surface the original error.

  return operation();
}

export async function upsertWorkItem(item: WorkItem, organizationId: string) {
  // Repair stale org prefix (if any) before writing.  This renames the DB row
  // and notifies the store callback so local state stays consistent.
  const oldToNew = await repairStaleOrgPrefixes([item], organizationId);
  const resolvedId = oldToNew[item.id] ?? item.id;
  const effectiveOrgId = item.organizationId ?? organizationId;

  const row: WorkItemUpsertRow = {
    id: resolvedId, title: item.title, description: item.description ?? null,
    points: item.points ?? null, status: item.status, parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments, rank: 0,
    organization_id: effectiveOrgId,
    respawn_enabled: item.respawnEnabled ?? false,
    respawn_interval_days: item.respawnIntervalDays ?? null,
    respawn_hour: item.respawnHour ?? null,
    respawn_minute: item.respawnMinute ?? null,
    respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(row as any).select().then(r => r));
  if (error) {
    console.error('upsertWorkItem:', error, 'row:', row);
    toast({ title: 'Failed to save', description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
  }
  // Persist per-backlog ranks to the dedicated table
  await upsertWorkItemBacklogRanks(resolvedId, item.ranks, effectiveOrgId);
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

export async function deleteWorkItems(ids: string[]) {
  if (ids.length === 0) return;
  // Also delete any double-prefixed variants that may exist in the DB
  const allIds = new Set(ids);
  ids.forEach(id => {
    const parts = id.split('::');
    if (parts.length === 2) {
      allIds.add(`${parts[0]}::${id}`);
    }
  });
  const { error } = await supabase.from('work_items').delete().in('id', [...allIds]);
  if (error) console.error('deleteWorkItems:', error);
}

export async function upsertBacklog(bl: Backlog, organizationId: string) {
  const { error } = await supabase.from('backlogs').upsert({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: safeRank(bl.rank),
    organization_id: ownerOrgOf(bl.id, organizationId),
  });
  if (error) console.error('upsertBacklog:', error);
}

export async function deleteBacklogs(ids: string[]) {
  if (ids.length === 0) return;
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
  });
  if (error) console.error('upsertBacklogTree:', error);
}

export async function deleteBacklogTree(id: string) {
  // Also delete any double-prefixed variants that may exist in the DB
  const parts = id.split('::');
  const allIds = [id];
  if (parts.length === 2) {
    allIds.push(`${parts[0]}::${id}`);
  }
  const { error } = await supabase.from('backlog_trees').delete().in('id', allIds);
  if (error) console.error('deleteBacklogTree:', error);
}

export async function upsertWorkItems(items: WorkItem[], organizationId: string) {
  if (items.length === 0) return;

  // Repair any stale org prefixes before writing.
  const oldToNew = await repairStaleOrgPrefixes(items, organizationId);

  const rows: WorkItemUpsertRow[] = items.map(item => {
    const resolvedId = oldToNew[item.id] ?? item.id;
    const effectiveOrgId = item.organizationId ?? organizationId;
    return {
      id: resolvedId, title: item.title, description: item.description ?? null,
      points: item.points ?? null, status: item.status, parent_id: item.parentId,
      backlog_assignments: item.backlogAssignments, rank: 0,
      organization_id: effectiveOrgId,
      respawn_enabled: item.respawnEnabled ?? false,
      respawn_interval_days: item.respawnIntervalDays ?? null,
      respawn_hour: item.respawnHour ?? null,
      respawn_minute: item.respawnMinute ?? null,
      respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
    };
  });
  // Dedupe by id (last write wins) so a single upsert payload never contains
  // two rows that conflict on the same primary key — Postgres rejects those
  // with "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const dedupedById = new Map<string, WorkItemUpsertRow>();
  for (const row of rows) dedupedById.set(row.id, row);
  const dedupedRows = Array.from(dedupedById.values());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(dedupedRows as any).select().then(r => r));
  if (error) {
    console.error('upsertWorkItems:', error, 'rows:', dedupedRows);
    toast({ title: 'Failed to save', description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
  }
  // Persist per-backlog ranks to the dedicated table
  await upsertWorkItemBacklogRanksBatch(items, oldToNew, organizationId);
}

export async function upsertBacklogs(bls: Backlog[], organizationId: string) {
  if (bls.length === 0) return;
  const rows = bls.map(bl => ({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: safeRank(bl.rank),
    organization_id: ownerOrgOf(bl.id, organizationId),
  }));
  const { error } = await supabase.from('backlogs').upsert(rows);
  if (error) console.error('upsertBacklogs:', error);
}

export async function upsertBacklogTrees(trees: BacklogTree[], organizationId: string) {
  if (trees.length === 0) return;
  const rows = trees.map(t => ({
    id: t.id, name: t.name, rank: safeRank(t.rank),
    organization_id: ownerOrgOf(t.id, organizationId),
  }));
  const { error } = await supabase.from('backlog_trees').upsert(rows);
  if (error) console.error('upsertBacklogTrees:', error);
}

type MockDataSnapshot = {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
};

function scopeMockDataToOrganization(organizationId: string, mockData: MockDataSnapshot): MockDataSnapshot {
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
    points: item.points ?? null,
    status: item.status,
    parent_id: item.parentId,
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

// ─── Work Item Backlog Ranks CRUD ─────────────────────────────────────────

/** Load per-backlog ranks for a set of work items from the work_item_backlog_ranks table. */
async function loadWorkItemBacklogRanks(
  workItemIds: string[],
): Promise<Record<string, Record<string, number>>> {
  if (workItemIds.length === 0) return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from('work_item_backlog_ranks' as any).select('*').in('work_item_id', workItemIds);
  if (error) { console.error('loadWorkItemBacklogRanks:', error); return {}; }
  const result: Record<string, Record<string, number>> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const wiId = row.work_item_id as string;
    if (!result[wiId]) result[wiId] = {};
    result[wiId][row.backlog_id as string] = (row.rank as number) ?? 0;
  }
  return result;
}

/** Upsert per-backlog ranks for a single work item. */
async function upsertWorkItemBacklogRanks(
  workItemId: string,
  ranks: Record<string, number>,
  organizationId: string,
): Promise<void> {
  const rows = Object.entries(ranks).map(([backlogId, rank]) => ({
    work_item_id: workItemId,
    backlog_id: backlogId,
    rank: safeRank(rank),
    organization_id: organizationId,
  }));
  if (rows.length === 0) return;
  // Sort by (work_item_id, backlog_id) so concurrent upserts always acquire
  // row locks in the same order, preventing PostgreSQL deadlocks.
  rows.sort((a, b) => a.work_item_id < b.work_item_id ? -1 : a.work_item_id > b.work_item_id ? 1 : a.backlog_id < b.backlog_id ? -1 : a.backlog_id > b.backlog_id ? 1 : 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('work_item_backlog_ranks' as any)
    .upsert(rows, { onConflict: 'work_item_id,backlog_id' });
  if (error) console.error('upsertWorkItemBacklogRanks:', error);
}

/** Upsert per-backlog ranks for a batch of work items. */
async function upsertWorkItemBacklogRanksBatch(
  items: WorkItem[],
  oldToNew: Record<string, string>,
  organizationId: string,
): Promise<void> {
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
  if (rows.length === 0) return;
  // Dedupe by (work_item_id, backlog_id) so a single payload never has two
  // rows targeting the same conflict key (would raise "cannot affect row a
  // second time"). Last write wins.
  const dedup = new Map<string, typeof rows[number]>();
  for (const r of rows) dedup.set(`${r.work_item_id}::${r.backlog_id}`, r);
  const deduped = Array.from(dedup.values());
  // Sort by (work_item_id, backlog_id) so concurrent upserts always acquire
  // row locks in the same order, preventing PostgreSQL deadlocks.
  deduped.sort((a, b) => a.work_item_id < b.work_item_id ? -1 : a.work_item_id > b.work_item_id ? 1 : a.backlog_id < b.backlog_id ? -1 : a.backlog_id > b.backlog_id ? 1 : 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('work_item_backlog_ranks' as any)
    .upsert(deduped, { onConflict: 'work_item_id,backlog_id' });
  if (error) console.error('upsertWorkItemBacklogRanksBatch:', error);
}

// ─── Hyperlink CRUD ───────────────────────────────────────────────────────

export async function loadHyperlinksForWorkItems(
  workItemIds: string[],
  organizationId?: string,
): Promise<Record<string, Hyperlink[]>> {
  if (workItemIds.length === 0) return {};
  // Prefer a single org-scoped fetch — passing hundreds of IDs via `.in()`
  // builds a URL that exceeds PostgREST's request size limit and returns nothing.
  // Fall back to chunked `.in()` queries when no org is provided.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] | null = null;
  let error: unknown = null;
  if (organizationId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await supabase.from('work_item_hyperlinks' as any)
      .select('*')
      .eq('organization_id', organizationId)
      .order('rank');
    data = res.data as any[] | null;
    error = res.error;
    // Filter to the requested work items so callers don't see hyperlinks for
    // items they didn't ask about (defensive — orgs are isolated anyway).
    if (data) {
      const idSet = new Set(workItemIds);
      data = data.filter((row) => idSet.has(row.work_item_id));
    }
  } else {
    const CHUNK = 100;
    const collected: any[] = [];
    for (let i = 0; i < workItemIds.length; i += CHUNK) {
      const slice = workItemIds.slice(i, i + CHUNK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await supabase.from('work_item_hyperlinks' as any)
        .select('*').in('work_item_id', slice).order('rank');
      if (res.error) { error = res.error; break; }
      if (res.data) collected.push(...(res.data as any[]));
    }
    if (!error) data = collected;
  }
  if (error) { console.error('loadHyperlinksForWorkItems:', error); return {}; }
  const result: Record<string, Hyperlink[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const link: Hyperlink = {
      id: row.id,
      workItemId: row.work_item_id,
      url: row.url,
      altText: row.alt_text ?? '',
      rank: row.rank ?? 0,
    };
    if (!result[link.workItemId]) result[link.workItemId] = [];
    result[link.workItemId].push(link);
  }
  return result;
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
